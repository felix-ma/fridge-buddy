'use strict';

/**
 * 多图拍摄引导的纯状态机（不含 WXML / wx API，可单测）。
 *
 * PRD 明确：不给"随便拍"入口。固定三视角、拍完自动切下一提示，
 * 因为跨图对齐质量几乎完全取决于"每一张明确对应哪个分区"。
 */

const MAX_SHOTS = 8;

const VIEWS = [
  {
    id: 'front',
    label: '正面全景',
    hint: '冰箱门打开，退后一步，把整层区域都拍进去',
    zone: '正面全景',
  },
  {
    id: 'top',
    label: '上层',
    hint: '从隔板正上方俯拍，别让隔板挡住食材',
    zone: '上层',
  },
  {
    id: 'bottom',
    label: '下层 / 果蔬盒',
    hint: '抽屉拉出来一点再拍，盒里的东西也要露出来',
    zone: '下层',
  },
];

/**
 * createSession() 返回一个会话对象：
 *   session.prompt   —— 当前该拍什么（null 表示拍完了）
 *   session.add(path) —— 记录一张已拍图片，自动进入下一个视角
 *   session.paths    —— 已拍图片路径（交给 prepareImages）
 * 状态都在对象里，重置调用 reset()。
 */
function createSession({ views = VIEWS, maxShots = MAX_SHOTS } = {}) {
  const shots = [];

  const session = {
    views,
    maxShots,

    get shots() {
      return shots.slice();
    },
    get paths() {
      return shots.map((s) => s.path);
    },
    get index() {
      return shots.length;
    },
    get total() {
      return views.length;
    },
    get done() {
      return shots.length >= views.length;
    },
    get full() {
      return shots.length >= maxShots;
    },
    get progressText() {
      return `${Math.min(shots.length + 1, views.length)}/${views.length}`;
    },

    /** 当前要给用户的提示；拍完了返回 null。 */
    get prompt() {
      if (session.done) return null;
      const view = views[shots.length];
      return {
        id: view.id,
        step: shots.length + 1,
        total: views.length,
        title: `第 ${shots.length + 1} 张 · ${view.label}`,
        label: view.label,
        hint: view.hint,
        zone: view.zone,
      };
    },

    add(path) {
      if (!path) return session;
      if (session.done) return session;
      const view = views[shots.length];
      shots.push({ path, zone: view.zone, viewId: view.id });
      return session;
    },

    /** 重拍：删掉最后一张，回到上一个视角。 */
    removeLast() {
      shots.pop();
      return session;
    },

    /** 还可以再拍几张（不因为引导拍完就锁死，只是提示语会变）。 */
    canAddMore() {
      return shots.length < Math.min(maxShots, views.length);
    },

    reset() {
      shots.length = 0;
      return session;
    },
  };

  return session;
}

/** 把会话转成云函数需要的 zone_hint / zones。 */
function toScanParams(session) {
  const zones = [];
  session.shots.forEach((s) => {
    if (s.zone && zones.indexOf(s.zone) === -1) zones.push(s.zone);
  });
  return {
    zone_hint: zones.join('+'),
    zones,
  };
}

module.exports = { VIEWS, MAX_SHOTS, createSession, toScanParams };
