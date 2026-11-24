import { enabledSkills, getSkill, createSkill } from '../skills.js';
import { getSettings } from '../config.js';

const CHANNELS = ['web', 'telegram', 'discord', 'slack', 'whatsapp', 'sms'];

export default [
  {
    name: 'send_message',
    group: 'messaging',
    risk: 'safe',
    description: 'Send a message to the user (only the user — never anyone else) on one of their connected apps: web, telegram, discord, slack, whatsapp or sms. Use for proactive updates or when they ask you to message them somewhere.',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string' }, channel: { type: 'string', enum: CHANNELS, description: 'Defaults to the current conversation' } },
      required: ['text'],
    },
    run: async ({ text, channel }, ctx) => {
      const { deliver } = await import('../channels/index.js');
      const target = channel || ctx.delivery.channel || 'web';
      const peer = target === ctx.delivery.channel ? ctx.delivery.peer : null;
      const r = await deliver({ channel: target, peer, sessionId: target === 'web' ? ctx.delivery.webSessionId : null, text: String(text), from: 'tool' });
      return r.ok ? `Message sent via ${target}.` : `Could not send via ${target}: ${r.error}`;
    },
  },
  {
    name: 'use_skill',
    group: 'skills',
    risk: 'safe',
    description: 'Load the full step-by-step instructions of one of your skills (see the skills list in your instructions) before doing that kind of task.',
    parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    run: ({ name }) => {
      const skill = getSkill(String(name).trim());
      if (!skill || !skill.enabled) {
        const names = enabledSkills().map((s) => s.name).join(', ');
        return `No skill named "${name}". Available: ${names || 'none'}.`;
      }
      return `Skill "${skill.name}" — follow these instructions:\n\n${skill.body}`;
    },
  },
  {
    name: 'create_skill',
    group: 'skills',
    risk: 'write',
    summarize: (a) => `Create skill "${a.name}": ${a.description}`,
    description: 'Teach yourself a new reusable skill: a named set of step-by-step instructions for a kind of task the user will ask for again.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'lowercase-with-dashes' },
        description: { type: 'string', description: 'One line: when to use it' },
        instructions: { type: 'string', description: 'Markdown steps, tools to use, output format' },
      },
      required: ['name', 'description', 'instructions'],
    },
    run: (args) => {
      const s = createSkill(args);
      return `Created skill "${s.name}". It is now available to use_skill.`;
    },
  },
  {
    name: 'current_time',
    group: 'tasks',
    risk: 'safe',
    description: 'Get the exact current date and time.',
    parameters: { type: 'object', properties: {} },
    run: () => {
      const tz = getSettings().timezone;
      return new Date().toLocaleString('en-US', { timeZone: tz, dateStyle: 'full', timeStyle: 'long' });
    },
  },
];
