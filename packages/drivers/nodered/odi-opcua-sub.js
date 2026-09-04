/**
 * odi-opcua-sub — ODIServer OPC UA read driver.
 *
 * Drives tag reads for its channel through the wired OpcUa-Client node in
 * one of two update modes (node config updateMode):
 *
 *   subscribe (default) — emits one subscribe message per tag
 *     ({ topic: <nodeId>, interval: <scanRateMs> }) once at deploy. The
 *     client node queues these while connecting and auto-resubscribes
 *     after reconnects.
 *
 *   poll — registers the channel's tags as a batched read list
 *     ({ action: "readmultiple", topic: <nodeId> }), then triggers a
 *     batched read ({ action: "readmultiple", topic: "readmultiple" }) at
 *     the channel's fastest effective scan rate. Registration repeats on
 *     a slow timer so items re-register after a full reconnect.
 */
module.exports = function (RED) {
  'use strict'

  function OdiOpcUaSubNode(config) {
    RED.nodes.createNode(this, config)
    const node = this
    node.channelId = config.channelId
    const updateMode = config.updateMode === 'poll' ? 'poll' : 'subscribe'

    const runtime = RED.settings.odiRuntime
    if (!runtime || !runtime.store) {
      node.error('ODIServer runtime (RED.settings.odiRuntime.store) is not configured')
      return
    }

    // Effective per-tag scan rate: honor the device scan mode —
    // "respect-device" polls all tags at the device rate (mirrors flow-gen
    // effectiveScanRateMs).
    function collectTags() {
      const out = []
      const devices = runtime.store.listDevices(node.channelId).filter((d) => d.enabled)
      for (const device of devices) {
        const s = device.settings || {}
        const deviceRate =
          s.scanMode === 'respect-device' && typeof s.scanModeRateMs === 'number' && s.scanModeRateMs >= 50
            ? s.scanModeRateMs
            : null
        for (const tag of runtime.store.listTags(device.id)) {
          out.push({ address: tag.address, interval: deviceRate ?? tag.scanRateMs })
        }
      }
      return out
    }

    let pollTimer = null
    const timer = setTimeout(() => {
      try {
        const tags = collectTags()
        if (updateMode === 'poll') {
          for (const tag of tags) node.send({ action: 'readmultiple', topic: tag.address })
          const fastest = tags.reduce((min, t) => Math.min(min, t.interval || Infinity), Infinity)
          const pollMs = Math.max(250, fastest === Infinity ? 1000 : fastest)
          pollTimer = setInterval(() => {
            node.send({ action: 'readmultiple', topic: 'readmultiple' })
          }, pollMs)
          node.status({ fill: 'green', shape: 'dot', text: `polling ${tags.length} tags @ ${pollMs}ms` })
        } else {
          for (const tag of tags) node.send({ topic: tag.address, interval: tag.interval })
          node.status({ fill: 'green', shape: 'dot', text: `subscribed ${tags.length} tags` })
        }
      } catch (err) {
        node.error(err)
      }
    }, 2000) // let the client node construct; its cmdQueue covers the rest
    node.on('close', (removed, done) => {
      clearTimeout(timer)
      if (pollTimer) clearInterval(pollTimer)
      done()
    })
  }

  RED.nodes.registerType('odi-opcua-sub', OdiOpcUaSubNode)
}
