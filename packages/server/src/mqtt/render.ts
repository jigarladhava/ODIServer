import type {
  MqttAgentConfig,
  TagConfig,
  TagPrimitive,
  TagValue,
} from "@odiserver/core";

/**
 * Pure rendering/merge helpers for MQTT agents — no I/O, fully unit-testable.
 *
 * Topic/payload tokens: {channel} {channelId} {device} {deviceId} {tag}
 * {tagId} {dataType}, plus {value} {quality} {timestamp} in payloads.
 */

export interface PublishContext {
  channelId: string;
  channelName: string;
  deviceId: string;
  deviceName: string;
  tagId: string;
  tagName: string;
  dataType: TagConfig["dataType"];
}

/** Effective publish settings for one tag on one agent (agent defaults + tag override). */
export interface ResolvedPublishConfig {
  topic: string;
  mode: "on-change" | "interval";
  intervalMs: number;
  deadband: number;
  qos: 0 | 1 | 2;
  retain: boolean;
  payloadFormat: "default" | "template";
  payloadTemplate: string;
}

/**
 * Merge agent defaults with the tag's per-agent override (tag.mqtt[agent.id]).
 * Returns null when the tag is opted out of this agent.
 */
export function resolvePublishConfig(
  agent: MqttAgentConfig,
  tag: TagConfig,
): ResolvedPublishConfig | null {
  const override = tag.mqtt?.[agent.id];
  if (override?.enabled === false) return null;
  return {
    topic: override?.topic ?? agent.topicPattern,
    mode: override?.mode ?? agent.mode,
    intervalMs: override?.intervalMs ?? agent.intervalMs,
    deadband: override?.deadband ?? agent.deadband,
    qos: override?.qos ?? agent.qos,
    retain: override?.retain ?? agent.retain,
    payloadFormat: override?.payloadFormat ?? agent.payloadFormat,
    payloadTemplate: override?.payloadTemplate ?? agent.payloadTemplate,
  };
}

function replaceTokens(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}

/** Render a topic pattern (or an explicit per-tag topic) for a tag. */
export function renderTopic(pattern: string, ctx: PublishContext): string {
  return replaceTokens(pattern, {
    channel: ctx.channelName,
    channelId: ctx.channelId,
    device: ctx.deviceName,
    deviceId: ctx.deviceId,
    tag: ctx.tagName,
    tagId: ctx.tagId,
    dataType: ctx.dataType,
  });
}

/**
 * Render the publish payload. The default format is a small JSON document;
 * a template substitutes tokens, with {value} JSON-encoded so numbers and
 * booleans keep their type when the template is JSON.
 */
export function renderPayload(
  format: "default" | "template",
  template: string,
  ctx: PublishContext,
  value: TagValue,
): string {
  if (format === "template") {
    return replaceTokens(template, {
      channel: ctx.channelName,
      channelId: ctx.channelId,
      device: ctx.deviceName,
      deviceId: ctx.deviceId,
      tag: ctx.tagName,
      tagId: ctx.tagId,
      dataType: ctx.dataType,
      value: JSON.stringify(value.value),
      quality: value.quality,
      timestamp: String(value.timestamp),
    });
  }
  return JSON.stringify({
    tag: ctx.tagName,
    value: value.value,
    quality: value.quality,
    timestamp: value.timestamp,
  });
}

/**
 * Agent-side deadband check against the last published value.
 * `undefined` prev means "never published" — always publish.
 * Null transitions always publish; numbers use the absolute deadband;
 * anything else uses strict inequality.
 */
export function exceedsDeadband(
  prev: TagPrimitive | null | undefined,
  next: TagPrimitive | null,
  deadband: number,
): boolean {
  if (prev === undefined) return true;
  if (prev === null || next === null) return prev !== next;
  if (typeof prev === "number" && typeof next === "number") {
    return Math.abs(next - prev) > deadband;
  }
  return prev !== next;
}
