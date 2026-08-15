/**
 * odi-tag-out — ODIServer write bridge node.
 *
 * Subscribes to tag-engine "write" events for one tag and forwards the value
 * to a modbus-write node. Register values are encoded honoring the tag's
 * dataType and byteOrder (splitRegisters), so multi-register writes land on
 * the wire exactly as the matching reads decode them.
 *
 * The tag engine (RED.settings.odiRuntime.engine) already rejects writes to
 * read-only tags before the event is emitted.
 */
module.exports = function (RED) {
  'use strict'
  const { splitRegisters } = require('./byte-order')

  /** Coerce the write value into what the modbus-write node expects. */
  function encodeValue(value, tagConfig) {
    const dataType = tagConfig ? tagConfig.dataType : 'uint16'
    if (dataType === 'bool') return value ? 1 : 0
    switch (dataType) {
      case 'int8':
      case 'uint8':
      case 'int16':
      case 'uint16':
      case 'int32':
      case 'uint32':
      case 'int64':
      case 'uint64':
      case 'float32':
      case 'float64':
      case 'bcd':
      case 'lbcd':
      case 'date': {
        const registers = splitRegisters(value, dataType, tagConfig.byteOrder)
        return registers.length === 1 ? registers[0] : registers
      }
      default:
        return value
    }
  }

  function OdiTagOutNode(config) {
    RED.nodes.createNode(this, config)
    const node = this
    node.tagId = config.tagId

    const runtime = RED.settings.odiRuntime
    if (!runtime || !runtime.engine) {
      node.error('ODIServer runtime (RED.settings.odiRuntime.engine) is not configured')
      return
    }
    const engine = runtime.engine

    const onWrite = (request) => {
      if (!request || request.tagId !== node.tagId) return
      try {
        const tagConfig = engine.getConfig(node.tagId)
        if (!tagConfig) return // tag removed; flow redeploy will clean up
        node.send({ payload: { value: encodeValue(request.value, tagConfig) } })
      } catch (err) {
        node.error(err)
      }
    }
    engine.on('write', onWrite)
    node.on('close', function (removed, done) {
      engine.off('write', onWrite)
      done()
    })
  }

  RED.nodes.registerType('odi-tag-out', OdiTagOutNode)
}
