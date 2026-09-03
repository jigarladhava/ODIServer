/**
 * odi-opcua-sub — ODIServer OPC UA subscribe emitter.
 *
 * Emits one subscribe message per tag of the node's channel
 * ({ topic: <nodeId>, interval: <scanRateMs> }) into the wired OpcUa-Client
 * node. The client node queues these while connecting and auto-resubscribes
 * after reconnects, so emission happens once at deploy.
 */
module.exports = function (RED) {
  'use strict'

  function OdiOpcUaSubNode(config) {
    RED.nodes.createNode(this, config)
    const node = this
    node.channelId = config.channelId

    const runtime = RED.settings.odiRuntime
    if (!runtime || !runtime.store) {
      node.error('ODIServer runtime (RED.settings.odiRuntime.store) is not configured')
      return
    }

    const timer = setTimeout(() => {
      try {
        const devices = runtime.store.listDevices(node.channelId).filter((d) => d.enabled)
        let count = 0
        for (const device of devices) {
          // Honor the device scan mode: "respect-device" polls all tags at
          // the device rate (mirrors flow-gen effectiveScanRateMs).
          const s = device.settings || {}
          const deviceRate =
            s.scanMode === 'respect-device' && typeof s.scanModeRateMs === 'number' && s.scanModeRateMs >= 50
              ? s.scanModeRateMs
              : null
          for (const tag of runtime.store.listTags(device.id)) {
            node.send({ topic: tag.address, interval: deviceRate ?? tag.scanRateMs })
            count++
          }
        }
        node.status({ fill: 'green', shape: 'dot', text: `subscribed ${count} tags` })
      } catch (err) {
        node.error(err)
      }
    }, 2000) // let the client node construct; its cmdQueue covers the rest
    node.on('close', (removed, done) => {
      clearTimeout(timer)
      done()
    })
  }

  RED.nodes.registerType('odi-opcua-sub', OdiOpcUaSubNode)
}
