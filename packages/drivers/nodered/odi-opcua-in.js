/**
 * odi-opcua-in — ODIServer OPC UA inbound bridge.
 *
 * Receives everything an OpcUa-Client node (and its status watcher) emits
 * and routes it into the tag engine:
 *   - value msgs   { topic: <nodeId>, payload, statusCode } — the nodeId is
 *                  mapped to a tag via the channel's tag addresses; bad
 *                  statusCodes become bad quality instead of values
 *   - error msgs   { error, endpoint } (no topic) — endpoint-level failures
 *                  mark every tag of the channel bad
 *   - status msgs  { status: { text } } from a status node scoped to the
 *                  client — connection-loss texts mark the channel bad
 *                  (recovery comes from subscription updates)
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
    node.channelId = config.channelId

    const runtime = RED.settings.odiRuntime
    if (!runtime || !runtime.engine || !runtime.store) {
      node.error('ODIServer runtime (RED.settings.odiRuntime.engine/store) is not configured')
      return
    }
    const { engine, store } = runtime

    // nodeId (tag address) -> tagId, rebuilt when the config changes.
    let byAddress = null
    function addressIndex() {
      if (byAddress) return byAddress
      byAddress = new Map()
      for (const device of store.listDevices(node.channelId)) {
        for (const tag of store.listTags(device.id)) byAddress.set(tag.address, tag.id)
      }
      return byAddress
    }
    const onConfigChange = () => { byAddress = null }
    store.on('change', onConfigChange)

    function markChannelBad(reason) {
      for (const device of store.listDevices(node.channelId)) {
        engine.setQualityForDevice(device.id, 'bad', reason)
      }
    }

    node.on('input', function (msg) {
      try {
        // Status watcher msgs: { status: { text } }, no topic.
        if (!msg.topic && msg.status && msg.status.text !== undefined) {
          const text = String(msg.status.text)
          if (BAD_STATUS.test(text)) markChannelBad('OPC UA connection: ' + text)
          return
        }
        // Endpoint-level errors: { error }, no topic.
        if (!msg.topic && msg.error) {
          const errMsg = msg.error.message ? String(msg.error.message) : String(msg.error)
          markChannelBad(errMsg)
          return
        }
        if (!msg.topic || typeof msg.topic !== 'string') return
        const address = msg.topic.split(';datatype=')[0]
        const tagId = addressIndex().get(address)
        if (!tagId) return // tag not in this channel (or removed)

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
