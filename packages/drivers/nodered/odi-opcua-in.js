/**
 * odi-opcua-in — ODIServer OPC UA inbound bridge.
 *
 * One instance per connection group (node config channelIds: string[]).
 * Receives everything the group's shared OpcUa-Client node (and its status
 * watcher) emits and routes it into the tag engine:
 *   - value msgs   { topic: <nodeId>, payload, statusCode } — the nodeId is
 *                  mapped to a tag via the group channels' tag addresses;
 *                  bad statusCodes become bad quality instead of values
 *   - error msgs   { error, endpoint } (no topic) — endpoint-level failures
 *                  mark every tag of the group bad
 *   - status msgs  { status: { text } } from a status node scoped to the
 *                  client — connection-loss texts mark the group bad
 *                  (recovery comes from subscription updates)
 *
 * Tag addresses embed the channel name (ns=2;s=Channel.Device.Tag), so a
 * single router per group is unambiguous — and avoids broadcasting every
 * value msg to dozens of per-channel nodes.
 */
module.exports = function (RED) {
  'use strict'

  const BAD_STATUS = /error|timeout|disconnect|broken|fail|stopped|closed|terminated|reconnect|invalid/i

  function coerce(payload) {
    if (payload === null || payload === undefined) return null
    if (typeof payload === 'boolean' || typeof payload === 'number') return payload
    if (typeof payload === 'string') return payload
    if (payload instanceof Date) return payload.toISOString()
    return String(payload)
  }

  /** True when an OPC UA statusCode object reports good (limit bits count as good). */
  function isGoodish(statusCode) {
    if (!statusCode) return true // no status reported — treat as good
    if (typeof statusCode.isGoodish === 'function') return statusCode.isGoodish()
    // Serialized StatusCode (crossed a JSON boundary): fall back to the value field.
    const value = statusCode.value
    if (typeof value !== 'number') return true
    return (value & 0xc0000000) === 0
  }

  function isUncertain(statusCode) {
    if (!statusCode) return false
    if (typeof statusCode.isUncertain === 'function') return statusCode.isUncertain()
    const value = statusCode.value
    if (typeof value !== 'number') return false
    return (value & 0xc0000000) === 0x40000000
  }

  function statusText(statusCode) {
    if (!statusCode) return undefined
    if (statusCode.description) return String(statusCode.description)
    if (typeof statusCode.toString === 'function') return statusCode.toString()
    return 'OPC UA bad status'
  }

  function OdiOpcUaInNode(config) {
    RED.nodes.createNode(this, config)
    const node = this
    const channelIds = Array.isArray(config.channelIds) && config.channelIds.length > 0
      ? config.channelIds
      : config.channelId
        ? [config.channelId]
        : []

    const runtime = RED.settings.odiRuntime
    if (!runtime || !runtime.engine || !runtime.store) {
      node.error('ODIServer runtime (RED.settings.odiRuntime.engine/store) is not configured')
      return
    }
    const { engine, store } = runtime

    // nodeId (tag address) -> tagId across the whole group, rebuilt when
    // the config changes.
    let byAddress = null
    function addressIndex() {
      if (byAddress) return byAddress
      byAddress = new Map()
      for (const channelId of channelIds) {
        for (const device of store.listDevices(channelId)) {
          for (const tag of store.listTags(device.id)) byAddress.set(tag.address, tag.id)
        }
      }
      return byAddress
    }
    const onConfigChange = () => { byAddress = null; deviceIds = null }
    store.on('change', onConfigChange)

    // Device ids of the group, rebuilt when the config changes — error
    // floods would otherwise re-query the store per message.
    let deviceIds = null
    function groupDeviceIds() {
      if (deviceIds) return deviceIds
      deviceIds = channelIds.flatMap((channelId) =>
        store.listDevices(channelId).map((d) => d.id),
      )
      return deviceIds
    }

    function markGroupBad(reason) {
      for (const deviceId of groupDeviceIds()) {
        engine.setQualityForDevice(deviceId, 'bad', reason)
      }
    }

    node.on('input', function (msg) {
      try {
        // Status watcher msgs: { status: { text } }, no topic.
        if (!msg.topic && msg.status && msg.status.text !== undefined) {
          const text = String(msg.status.text)
          if (BAD_STATUS.test(text)) markGroupBad('OPC UA connection: ' + text)
          return
        }
        // Endpoint-level errors: { error }, no topic.
        if (!msg.topic && msg.error) {
          const errMsg = msg.error.message ? String(msg.error.message) : String(msg.error)
          markGroupBad(errMsg)
          return
        }
        if (!msg.topic || typeof msg.topic !== 'string') return
        const address = msg.topic.split(';datatype=')[0]
        const tagId = addressIndex().get(address)
        if (!tagId) return // tag not in this group (or removed)

        if (msg.error) {
          const errMsg = msg.error.message ? String(msg.error.message) : String(msg.error)
          engine.setQuality(tagId, 'bad', errMsg)
          return
        }
        if (!isGoodish(msg.statusCode)) {
          if (isUncertain(msg.statusCode)) {
            engine.setQuality(tagId, 'uncertain', statusText(msg.statusCode))
          } else {
            engine.setQuality(tagId, 'bad', statusText(msg.statusCode))
          }
          return
        }
        const value = coerce(msg.payload)
        if (value === null) return
        engine.updateRaw(tagId, value, 'good')
      } catch (err) {
        node.error(err, msg)
      }
    })

    node.on('close', function (removed, done) {
      store.off('change', onConfigChange)
      done()
    })
  }

  RED.nodes.registerType('odi-opcua-in', OdiOpcUaInNode)
}
