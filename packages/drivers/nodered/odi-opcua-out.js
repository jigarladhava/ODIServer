/**
 * odi-opcua-out — ODIServer OPC UA write bridge.
 *
 * Subscribes to tag-engine "write" events for every rw tag of the node's
 * channel and forwards them to the wired OpcUa-Client node as
 * { topic: "<nodeId>;datatype=<Type>", payload: value, action: "write" }.
 * The datatype suffix is required by the contrib write action to build a
 * correctly typed Variant; int64/uint64 are not writable through this node
 * (the contrib encodes 64-bit ints from a { value } object).
 */
module.exports = function (RED) {
  'use strict'

  const WRITE_DATA_TYPE = {
    bool: 'Boolean',
    int8: 'Int8',
    uint8: 'UInt8',
    int16: 'Int16',
    uint16: 'UInt16',
    int32: 'Int32',
    uint32: 'UInt32',
    float32: 'Float',
    float64: 'Double',
    bcd: 'UInt16',
    lbcd: 'UInt32',
    date: 'DateTime',
    string: 'String',
  }

  function OdiOpcUaOutNode(config) {
    RED.nodes.createNode(this, config)
    const node = this
    node.channelId = config.channelId

    const runtime = RED.settings.odiRuntime
    if (!runtime || !runtime.engine || !runtime.store) {
      node.error('ODIServer runtime (RED.settings.odiRuntime.engine/store) is not configured')
      return
    }
    const { engine, store } = runtime

    // tagId -> { address, dataType }, rebuilt on config change.
    let byTagId = null
    function tagIndex() {
      if (byTagId) return byTagId
      byTagId = new Map()
      for (const device of store.listDevices(node.channelId)) {
        for (const tag of store.listTags(device.id)) {
          if (tag.access === 'rw') byTagId.set(tag.id, { address: tag.address, dataType: tag.dataType })
        }
      }
      return byTagId
    }
    const onConfigChange = () => { byTagId = null }
    store.on('change', onConfigChange)

    const onWrite = (request) => {
      if (!request || !tagIndex().has(request.tagId)) return
      try {
        const tag = tagIndex().get(request.tagId)
        const datatype = WRITE_DATA_TYPE[tag.dataType]
        if (!datatype) {
          node.warn(`Tag ${request.tagId}: dataType ${tag.dataType} is not writable over OPC UA — write ignored`)
          return
        }
        node.send({ topic: `${tag.address};datatype=${datatype}`, payload: request.value, action: 'write' })
      } catch (err) {
        node.error(err)
      }
    }
    engine.on('write', onWrite)
    node.on('close', function (removed, done) {
      engine.off('write', onWrite)
      store.off('change', onConfigChange)
      done()
    })
  }

  RED.nodes.registerType('odi-opcua-out', OdiOpcUaOutNode)
}
