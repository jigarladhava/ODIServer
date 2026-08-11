/**
 * odi-tag-in — ODIServer bridge node.
 *
 * Receives polled driver values and pushes them into the ODIServer tag
 * engine (exposed via RED.settings.odiRuntime.engine by the host process).
 *
 * Modes:
 *   value   — extract the value from msg.payload and updateRaw(tagId, value)
 *   quality — setQuality(tagId, config.quality); wired from catch nodes so
 *             driver errors propagate as bad/uncertain tag quality
 */
module.exports = function (RED) {
  'use strict'
  const { combineRegisters } = require('./byte-order')

  function firstValue(payload) {
    return Array.isArray(payload) ? payload[0] : payload
  }

  function extractValue(payload, tagConfig) {
    if (Array.isArray(payload) && payload.length > 0 && tagConfig) {
      switch (tagConfig.dataType) {
        case 'int16':
        case 'uint16':
        case 'int32':
        case 'uint32':
        case 'float32':
        case 'float64':
          return combineRegisters(payload, tagConfig.dataType, tagConfig.byteOrder)
        default:
          break
      }
    }
    const value = firstValue(payload)
    if (typeof value === 'boolean') return value
    if (typeof value === 'number') return value
    if (value === null || value === undefined) return null
    return String(value)
  }

  function OdiTagInNode(config) {
    RED.nodes.createNode(this, config)
    const node = this
    node.tagId = config.tagId
    node.deviceId = config.deviceId
    node.mode = config.mode || 'value'
    node.quality = config.quality || 'bad'
    // Block-read member: slice this tag's registers out of the block payload.
    node.blockOffset = config.blockOffset === undefined || config.blockOffset === '' ? null : Number(config.blockOffset)
    node.blockCount = config.blockCount === undefined || config.blockCount === '' ? 1 : Number(config.blockCount)

    const runtime = RED.settings.odiRuntime
    if (!runtime || !runtime.engine) {
      node.error('ODIServer runtime (RED.settings.odiRuntime.engine) is not configured')
      return
    }

    node.on('input', function (msg) {
      try {
        const engine = runtime.engine
        if (node.mode === 'quality') {
          const errMsg = msg.error && msg.error.message ? String(msg.error.message) : undefined
          engine.setQuality(node.tagId, node.quality, errMsg)
          return
        }
        if (node.mode === 'device-quality') {
          // Driven by a status node scoped to the device's client node.
          const text = String((msg.status && msg.status.text) || '')
          const bad = /error|timeout|disconnect|broken|fail|stopped|closed/i.test(text)
          if (bad) engine.setQualityForDevice(node.deviceId, 'bad', 'Device communication: ' + (text || 'not connected'))
          return
        }
        const tagConfig = engine.getConfig(node.tagId)
        if (!tagConfig) return // tag was removed; flow redeploy will clean up
        // Read failure: modbus-read (emptyMsgOnFail) forwards the error here.
        if (msg.error) {
          const errMsg = msg.error.message ? String(msg.error.message) : String(msg.error)
          engine.setQuality(node.tagId, 'bad', errMsg)
          return
        }
        // A successful read with no data means the slave has no registers at
        // this address (some servers answer with an empty set instead of an
        // exception) — that is a bad read, not a value.
        let payload = msg.payload
        if (node.blockOffset !== null && Array.isArray(payload)) {
          payload = payload.slice(node.blockOffset, node.blockOffset + node.blockCount)
        }
        if (Array.isArray(payload) && payload.length === 0) {
          engine.setQuality(node.tagId, 'bad', 'Empty response from device — address may not exist on the slave')
          return
        }
        if (payload === '' || payload === null || payload === undefined) {
          engine.setQuality(node.tagId, 'bad', 'Empty response from device')
          return
        }
        const value = extractValue(payload, tagConfig)
        if (value === null) return
        engine.updateRaw(node.tagId, value, 'good')
      } catch (err) {
        node.error(err, msg)
      }
    })
  }

  RED.nodes.registerType('odi-tag-in', OdiTagInNode)
}
