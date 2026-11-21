import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCommand } from '../src/command.js';

test('空消息和帮助返回用法', () => {
  assert.equal(parseCommand('').type, 'help');
  assert.equal(parseCommand(' 帮助 ').type, 'help');
});

test('只写「打包」使用默认值', () => {
  assert.deepEqual(parseCommand(' 打包', { defaultBranch: 'develop' }), {
    type: 'build',
    httpEnv: 'qa',
    branch: 'develop',
    channel: 'official',
    runChecks: false,
    updateDesc: '',
  });
});

test('解析环境、分支、渠道、检查和带空格的说明', () => {
  assert.deepEqual(parseCommand('打包 pro release/1.2.0 渠道=huawei 检查 说明=修复 登录 问题'), {
    type: 'build',
    httpEnv: 'pro',
    branch: 'release/1.2.0',
    channel: 'huawei',
    runChecks: true,
    updateDesc: '修复 登录 问题',
  });
});

test('支持中文冒号和英文关键字', () => {
  const result = parseCommand('build QA feature/a channel:xiaomi desc：测试');
  assert.equal(result.httpEnv, 'qa');
  assert.equal(result.branch, 'feature/a');
  assert.equal(result.channel, 'xiaomi');
  assert.equal(result.updateDesc, '测试');
});

test('非法分支、渠道、超长说明和多余参数被拒绝', () => {
  assert.equal(parseCommand('打包 qa main;rm').type, 'error');
  assert.equal(parseCommand('打包 qa $(id)').type, 'error');
  assert.equal(parseCommand('打包 渠道=hua-wei').type, 'error');
  assert.equal(parseCommand(`打包 说明=${'字'.repeat(201)}`).type, 'error');
  assert.equal(parseCommand('打包 main develop').type, 'error');
  assert.equal(parseCommand('发布 main').type, 'error');
});
