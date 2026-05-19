const MAX_HP = 50;
const MAX_ENERGY = 30;
const MAX_MANA = 5;
const MIN_SPELL_MANA = 3;
const START_MANA = 2.5;
const PLAN_LENGTH = 6;
const EPS = 0.0001;
const DAMAGE_SCALE = 3;
const DEFENSE_SCALE = 3;
const PARTIAL_BLOCK_VALUE = 3;
const PROTECT_TEMP_HP = 9;

const ACTIONS = {
  attack: { label: "Удар", short: "Удар" },
  powerAttack: { label: "Мощный удар", short: "Мощн." },
  fullBlock: { label: "Полный блок", short: "Полн. блок" },
  partialBlock: { label: "Частичный блок", short: "Част. блок" },
  protect: { label: "Защититься", short: "Защита" },
  predict: { label: "Предсказать", short: "Прогноз" },
  deepPredict: { label: "Глубокий прогноз", short: "Глуб. прог." },
  rest: { label: "Отдых", short: "Отдых" },
  relax: { label: "Расслабиться", short: "Расслаб." },
  relaxHold: { label: "Расслабление", short: "Расслаб." },
  meditate: { label: "Медитация", short: "Медит." },
  wait: { label: "Ничего", short: "Ничего" },
  spellHeal: { label: "Лечение", short: "Лечение" },
  spellEnergy: { label: "Заряд энергии", short: "Энергия" },
  spellEmpower: { label: "Усиление", short: "Усил." },
  choice: { label: "Выбор", short: "Выбор" },
  enemyChoice: { label: "Выбор", short: "Выбор" },
  spellHold: { label: "Каст", short: "Каст" },
};

const SPELL_LABELS = {
  spellHeal: "Лечение",
  spellEnergy: "Заряд энергии",
  spellEmpower: "Усиление",
};

const state = {
  phase: "prep",
  player: makeFighter("Ты"),
  enemy: makeFighter("Противник"),
  plan: [],
  enemyPlan: [],
  activeIndex: -1,
  awaitingChoice: false,
  running: false,
};

const els = {
  phaseLabel: document.querySelector("#phaseLabel"),
  plannerHint: document.querySelector("#plannerHint"),
  playerHpText: document.querySelector("#playerHpText"),
  playerEnergyText: document.querySelector("#playerEnergyText"),
  playerManaText: document.querySelector("#playerManaText"),
  enemyHpText: document.querySelector("#enemyHpText"),
  enemyEnergyText: document.querySelector("#enemyEnergyText"),
  enemyManaText: document.querySelector("#enemyManaText"),
  playerHpBar: document.querySelector("#playerHpBar"),
  playerEnergyBar: document.querySelector("#playerEnergyBar"),
  playerManaBar: document.querySelector("#playerManaBar"),
  enemyHpBar: document.querySelector("#enemyHpBar"),
  enemyEnergyBar: document.querySelector("#enemyEnergyBar"),
  enemyManaBar: document.querySelector("#enemyManaBar"),
  playerStatus: document.querySelector("#playerStatus"),
  enemyStatus: document.querySelector("#enemyStatus"),
  playerCurrentAction: document.querySelector("#playerCurrentAction"),
  enemyCurrentAction: document.querySelector("#enemyCurrentAction"),
  forecastText: document.querySelector("#forecastText"),
  actionButtons: document.querySelector("#actionButtons"),
  sequenceSlots: document.querySelector("#sequenceSlots"),
  slotCounter: document.querySelector("#slotCounter"),
  startRound: document.querySelector("#startRound"),
  nextStep: document.querySelector("#nextStep"),
  roundStep: document.querySelector("#roundStep"),
  undoAction: document.querySelector("#undoAction"),
  clearPlan: document.querySelector("#clearPlan"),
  newGame: document.querySelector("#newGame"),
  battleLog: document.querySelector("#battleLog"),
  playerFighter: document.querySelector("#playerFighter"),
  enemyFighter: document.querySelector("#enemyFighter"),
  playerEffect: document.querySelector("#playerEffect"),
  enemyEffect: document.querySelector("#enemyEffect"),
  clashText: document.querySelector("#clashText"),
};

function makeFighter(name) {
  return {
    name,
    hp: MAX_HP,
    energy: MAX_ENERGY,
    mana: START_MANA,
    combo: 0,
    tempHp: 0,
    tempExpiresAt: null,
    empowerCharges: 0,
    nextRoundEmpower: false,
    roundEmpower: false,
    pendingSpell: null,
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function fmt(value) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

function actionText(action) {
  return ACTIONS[action]?.label || action;
}

function addEnergy(fighter, amount) {
  fighter.energy = clamp(fighter.energy + amount, 0, MAX_ENERGY);
}

function addMana(fighter, amount) {
  fighter.mana = clamp(fighter.mana + amount, -MAX_MANA / 2, MAX_MANA);
}

function spendEnergy(fighter, amount) {
  if (fighter.energy + EPS < amount) return false;
  fighter.energy = clamp(fighter.energy - amount, 0, MAX_ENERGY);
  return true;
}

function nextAttackPower(fighter) {
  const step = fighter.combo + 1 > 3 ? 1 : fighter.combo + 1;
  return {
    comboStep: step,
    amount: step === 1 ? 1 : step === 2 ? 1.5 : 2,
  };
}

function forcedRest(fighter, reason) {
  fighter.combo = 0;
  addEnergy(fighter, 4);
  return {
    action: "rest",
    label: reason || "Вынужденный отдых",
    damage: 0,
    defense: "none",
    vulnerability: 2,
    manaGain: 0.3,
    success: false,
    notes: reason ? [reason] : [],
  };
}

function prepareAction(fighter, plannedAction, index) {
  if (fighter.hp <= 0) {
    return {
      action: "wait",
      label: "Побеждён",
      damage: 0,
      defense: "none",
      vulnerability: 1,
      manaGain: 0,
      success: false,
      notes: [],
    };
  }

  if (fighter.pendingSpell) {
    return {
      action: "spellHold",
      label: `Каст: ${SPELL_LABELS[fighter.pendingSpell.kind]}`,
      damage: 0,
      defense: "none",
      vulnerability: 1.25,
      manaGain: 0,
      success: true,
      finishSpell: fighter.pendingSpell,
      notes: ["заклинание завершается"],
    };
  }

  if (plannedAction === "choice" || plannedAction === "enemyChoice") {
    return forcedRest(fighter, "Выбор не сделан, воин отдыхает");
  }

  if (plannedAction === "spellHold") {
    return baseResult("spellHold", "Каст", { vulnerability: 1.25 });
  }

  if (plannedAction === "attack") {
    const attack = nextAttackPower(fighter);
    if (!spendEnergy(fighter, attack.amount)) {
      return forcedRest(fighter, "Не хватило энергии на удар");
    }
    return {
      action: "attack",
      label: `Удар x${fmt(attack.amount)}`,
      damage: attack.amount * DAMAGE_SCALE,
      defense: "none",
      vulnerability: 1,
      manaGain: 0.2,
      comboStep: attack.comboStep,
      comboAction: true,
      success: true,
      notes: [],
    };
  }

  fighter.combo = 0;

  if (plannedAction === "powerAttack") {
    if (!spendEnergy(fighter, 3)) return forcedRest(fighter, "Не хватило энергии на мощный удар");
    return baseResult("powerAttack", "Мощный удар", { damage: 2 * DAMAGE_SCALE, manaGain: 0.2 });
  }

  if (plannedAction === "fullBlock") {
    if (!spendEnergy(fighter, 1)) return forcedRest(fighter, "Не хватило энергии на полный блок");
    return baseResult("fullBlock", "Полный блок", { defense: "full", manaGain: 0.2 });
  }

  if (plannedAction === "partialBlock") {
    if (!spendEnergy(fighter, 0.5)) return forcedRest(fighter, "Не хватило энергии на частичный блок");
    return baseResult("partialBlock", "Частичный блок", { defense: "partial", manaGain: 0.2 });
  }

  if (plannedAction === "protect") {
    if (!spendEnergy(fighter, 3)) return forcedRest(fighter, "Не хватило энергии защититься");
    return baseResult("protect", "Защититься", {
      defense: "full",
      manaGain: 0.2,
      grantTempAfter: PROTECT_TEMP_HP,
      notes: [`на следующий ход будет ${PROTECT_TEMP_HP} временных хитов`],
    });
  }

  if (plannedAction === "predict") {
    if (!spendEnergy(fighter, 1)) return forcedRest(fighter, "Не хватило энергии на предсказание");
    return baseResult("predict", "Предсказать", { vulnerability: 1.5, manaGain: 0.2, revealCount: 1 });
  }

  if (plannedAction === "deepPredict") {
    if (!spendEnergy(fighter, 3)) return forcedRest(fighter, "Не хватило энергии на глубокий прогноз");
    return baseResult("deepPredict", "Глубокий прогноз", { vulnerability: 2, manaGain: 0.2, revealCount: 2 });
  }

  if (plannedAction === "rest") {
    addEnergy(fighter, 4);
    return baseResult("rest", "Отдых", { vulnerability: 2, manaGain: 0.3 });
  }

  if (plannedAction === "relax" || plannedAction === "relaxHold") {
    addEnergy(fighter, 6);
    return baseResult(plannedAction, plannedAction === "relax" ? "Расслабиться" : "Расслабление", { vulnerability: 3, manaGain: 0.3 });
  }

  if (plannedAction === "meditate") {
    addEnergy(fighter, 1);
    return baseResult("meditate", "Медитация", { vulnerability: 2, manaGain: 0.6 });
  }

  if (plannedAction === "wait") {
    addEnergy(fighter, 2);
    return baseResult("wait", "Ничего", { manaGain: 0.2 });
  }

  if (plannedAction === "spellHeal" || plannedAction === "spellEnergy" || plannedAction === "spellEmpower") {
    return prepareSpell(fighter, plannedAction, index);
  }

  addEnergy(fighter, 2);
  return baseResult("wait", "Ничего", { manaGain: 0.2 });
}

function baseResult(action, label, options = {}) {
  return {
    action,
    label,
    damage: options.damage || 0,
    defense: options.defense || "none",
    vulnerability: options.vulnerability || 1,
    manaGain: options.manaGain || 0,
    revealCount: options.revealCount || 0,
    grantTempAfter: options.grantTempAfter || 0,
    comboAction: false,
    success: true,
    notes: options.notes || [],
  };
}

function prepareSpell(fighter, kind, index) {
  const spent = clamp(fighter.mana, 0, MAX_MANA);
  if (spent + EPS < MIN_SPELL_MANA) {
    return forcedRest(fighter, "Нужно минимум 3 маны для магии");
  }

  const full = spent >= MAX_MANA - EPS;
  if (full && index >= PLAN_LENGTH - 1) {
    return forcedRest(fighter, "Полный каст не успеет завершиться");
  }

  fighter.mana = -spent / 2;
  const spell = { kind, spent, full };
  if (full) {
    fighter.pendingSpell = spell;
    return {
      action: "spellStart",
      label: `Каст: ${SPELL_LABELS[kind]}`,
      damage: 0,
      defense: "none",
      vulnerability: 1.25,
      manaGain: 0,
      success: true,
      notes: ["полная мана: заклинание займёт два хода"],
    };
  }

  return {
    action: kind,
    label: SPELL_LABELS[kind],
    damage: 0,
    defense: "none",
    vulnerability: 1.25,
    manaGain: 0,
    success: true,
    applySpell: spell,
    notes: [],
  };
}

function resolveHit(attacker, defender, attackResult, defenseResult) {
  let damage = attackResult.damage;
  const notes = [];
  let energyBlocked = 0;
  let partialBlocked = 0;
  let tempBlocked = 0;
  let empowered = false;

  if (damage <= 0) {
    return { dealt: 0, notes, energyBlocked, partialBlocked, tempBlocked, empowered };
  }

  if (attackResult.action === "attack" || attackResult.action === "powerAttack") {
    if (attacker.roundEmpower || attacker.empowerCharges > 0) {
      damage *= 1.5;
      empowered = true;
      if (!attacker.roundEmpower && attacker.empowerCharges > 0) {
        attacker.empowerCharges -= 1;
      }
    }
  }

  if (defenseResult.defense === "full") {
    const absorbCapacity = defender.energy * DEFENSE_SCALE;
    const absorbedDamage = Math.min(absorbCapacity, damage);
    const energyCost = absorbedDamage / DEFENSE_SCALE;
    if (absorbedDamage > 0) {
      spendEnergy(defender, energyCost);
      damage -= absorbedDamage;
      energyBlocked = energyCost;
    }
    if (damage > EPS) {
      notes.push("полный блок поглотил не всё: не хватило энергии");
    } else {
      notes.push(`полный блок поглотил урон: 1 энергия за ${DEFENSE_SCALE} урона`);
    }
  }

  if (defenseResult.defense === "partial") {
    if (spendEnergy(defender, 0.5)) {
      partialBlocked = Math.min(PARTIAL_BLOCK_VALUE, damage);
      damage -= partialBlocked;
      notes.push(`частичный блок снял ${PARTIAL_BLOCK_VALUE} урона`);
    } else {
      notes.push("не хватило энергии удержать частичный блок под ударом");
    }
  }

  if (damage > 0 && defenseResult.vulnerability !== 1) {
    damage *= defenseResult.vulnerability;
    notes.push(`уязвимость x${fmt(defenseResult.vulnerability)}`);
  }

  if (damage > 0 && defender.tempHp > 0) {
    tempBlocked = Math.min(defender.tempHp, damage);
    defender.tempHp = clamp(defender.tempHp - tempBlocked, 0, 99);
    damage -= tempBlocked;
    notes.push(`временные хиты поглотили ${fmt(tempBlocked)}`);
  }

  const dealt = Math.max(0, damage);
  if (dealt > 0) {
    defender.hp = clamp(defender.hp - dealt, 0, MAX_HP);
  }

  return { dealt, notes, energyBlocked, partialBlocked, tempBlocked, empowered };
}

function finalizeFighter(fighter, result, index) {
  if (result.comboAction && result.success) {
    fighter.combo = result.comboStep >= 3 ? 0 : result.comboStep;
  } else if (!result.comboAction) {
    fighter.combo = 0;
  }

  if (result.finishSpell) {
    applySpell(fighter, result.finishSpell);
    fighter.pendingSpell = null;
  }

  if (result.applySpell) {
    applySpell(fighter, result.applySpell);
  }

  if (result.manaGain) {
    addMana(fighter, result.manaGain);
  }

  if (fighter.tempExpiresAt === index) {
    fighter.tempHp = 0;
    fighter.tempExpiresAt = null;
  }

  if (result.grantTempAfter) {
    fighter.tempHp = Math.max(fighter.tempHp, result.grantTempAfter);
    fighter.tempExpiresAt = index + 1;
  }
}

function applySpell(fighter, spell) {
  if (spell.kind === "spellHeal") {
    const heal = spell.full ? spell.spent * 2 : spell.spent;
    fighter.hp = clamp(fighter.hp + heal, 0, MAX_HP);
    return;
  }

  if (spell.kind === "spellEnergy") {
    const energy = spell.full ? spell.spent * 3 : spell.spent * 2;
    fighter.energy = clamp(fighter.energy + energy, 0, MAX_ENERGY);
    return;
  }

  if (spell.kind === "spellEmpower") {
    if (spell.full) {
      fighter.nextRoundEmpower = true;
    } else {
      fighter.empowerCharges += Math.max(1, Math.ceil(spell.spent));
    }
  }
}

function chooseEnemyPlan() {
  const plan = [];
  let projectedEnergy = state.enemy.energy;
  let projectedMana = state.enemy.mana;
  let projectedCombo = state.enemy.combo;
  let protectedNext = state.enemy.tempHp > 0;
  const styleRoll = Math.random();
  const style = styleRoll < 0.34 ? "aggressive" : styleRoll < 0.67 ? "guarded" : "patient";

  for (let i = 0; i < PLAN_LENGTH; i += 1) {
    let action = chooseEnemyAction(style, projectedEnergy, projectedMana, projectedCombo, i);
    if (protectedNext && action === "fullBlock") {
      action = projectedEnergy >= 3 && Math.random() < 0.55 ? "powerAttack" : "attack";
    }
    plan.push(action);

    const projection = projectAction(action, projectedEnergy, projectedMana, projectedCombo);
    projectedEnergy = projection.energy;
    projectedMana = projection.mana;
    projectedCombo = projection.combo;

    const fullSpell = isSpellAction(action) && projection.wasFullSpell;
    protectedNext = action === "protect";

    if (action === "predict" && i < PLAN_LENGTH - 1) {
      plan.push("enemyChoice");
      i += 1;
      protectedNext = false;
    } else if (action === "deepPredict" && i < PLAN_LENGTH - 2) {
      plan.push("enemyChoice", "enemyChoice");
      i += 2;
      protectedNext = false;
    } else if ((action === "relax" || fullSpell) && i < PLAN_LENGTH - 1) {
      const holdAction = action === "relax" ? "relaxHold" : "spellHold";
      plan.push(holdAction);
      const holdProjection = projectAction(holdAction, projectedEnergy, projectedMana, projectedCombo);
      projectedEnergy = holdProjection.energy;
      projectedMana = holdProjection.mana;
      projectedCombo = holdProjection.combo;
      i += 1;
      protectedNext = false;
    }
  }

  return plan;
}

function chooseEnemyAction(style, energy, mana, combo, index) {
  const enemyHpRatio = state.enemy.hp / MAX_HP;
  const playerHpRatio = state.player.hp / MAX_HP;
  const playerEnergyRatio = state.player.energy / MAX_ENERGY;
  const playerManaReady = state.player.mana >= MIN_SPELL_MANA;
  const playerCanBurst = state.player.energy >= 3 || state.player.combo >= 1;
  const fullSpellCanFit = index < PLAN_LENGTH - 1;
  const canPredict = index < PLAN_LENGTH - 1;
  const canDeepPredict = index < PLAN_LENGTH - 2;
  const canUseTwoSlotAction = index < PLAN_LENGTH - 1;
  const canCastSpell = mana >= MIN_SPELL_MANA && (mana < MAX_MANA - EPS || fullSpellCanFit);
  const randomness = Math.random();

  if (canCastSpell && state.enemy.hp < 20 && Math.random() < 0.28) return "spellHeal";
  if (canCastSpell && energy < 9 && Math.random() < 0.26) return "spellEnergy";
  if (mana >= MAX_MANA - EPS && fullSpellCanFit && style === "aggressive" && Math.random() < 0.2) return "spellEmpower";
  if (energy < 2.5) return Math.random() < 0.58 || !canUseTwoSlotAction ? "rest" : "relax";
  if (energy < 6 && canUseTwoSlotAction && Math.random() < 0.24) return "relax";

  if (combo === 2 && energy >= 2 && Math.random() < 0.62) return "attack";
  if (playerHpRatio < 0.28 && energy >= 3 && Math.random() < 0.36) return "powerAttack";
  if ((playerCanBurst || playerManaReady) && energy >= 3 && Math.random() < (style === "guarded" ? 0.26 : 0.14)) return "protect";
  if (playerCanBurst && energy >= 1 && Math.random() < 0.22) return "fullBlock";
  if (playerEnergyRatio < 0.18 && enemyHpRatio > 0.45 && Math.random() < 0.28) return "meditate";
  if (enemyHpRatio < playerHpRatio && energy >= 3 && Math.random() < 0.18) return "powerAttack";
  if (energy >= 3 && Math.random() < (style === "aggressive" ? 0.12 : 0.06)) return "powerAttack";
  if (energy >= 3 && Math.random() < (style === "guarded" ? 0.1 : 0.04)) return "protect";
  if (canDeepPredict && energy >= 3 && Math.random() < 0.04) return "deepPredict";
  if (canPredict && energy >= 1 && Math.random() < 0.08) return "predict";

  const roll = randomness;
  if (style === "aggressive") {
    if (roll < 0.55) return "attack";
    if (roll < 0.68) return "fullBlock";
    if (roll < 0.79) return "partialBlock";
    if (roll < 0.91) return "wait";
    return "rest";
  }
  if (style === "guarded") {
    if (roll < 0.32) return "attack";
    if (roll < 0.52) return "fullBlock";
    if (roll < 0.69) return "partialBlock";
    if (roll < 0.84) return "wait";
    if (roll < 0.93) return "meditate";
    return "rest";
  }
  if (roll < 0.34) return "attack";
  if (roll < 0.48) return "fullBlock";
  if (roll < 0.6) return "partialBlock";
  if (roll < 0.78) return "wait";
  if (roll < 0.9) return "meditate";
  return "rest";
}

function projectAction(action, energy, mana, combo) {
  let nextEnergy = energy;
  let nextMana = mana;
  let nextCombo = 0;
  let wasFullSpell = false;

  if (action === "attack") {
    const step = combo + 1 > 3 ? 1 : combo + 1;
    const cost = step === 1 ? 1 : step === 2 ? 1.5 : 2;
    nextEnergy -= cost;
    nextMana += 0.2;
    nextCombo = step >= 3 ? 0 : step;
  } else if (action === "powerAttack") {
    nextEnergy -= 3;
    nextMana += 0.2;
  } else if (action === "fullBlock") {
    nextEnergy -= 1;
    nextMana += 0.2;
  } else if (action === "partialBlock") {
    nextEnergy -= 0.5;
    nextMana += 0.2;
  } else if (action === "protect") {
    nextEnergy -= 3;
    nextMana += 0.2;
  } else if (action === "predict") {
    nextEnergy -= 1;
    nextMana += 0.2;
  } else if (action === "deepPredict") {
    nextEnergy -= 3;
    nextMana += 0.2;
  } else if (action === "rest") {
    nextEnergy += 4;
    nextMana += 0.3;
  } else if (action === "relax" || action === "relaxHold") {
    nextEnergy += 6;
    nextMana += 0.3;
  } else if (action === "meditate") {
    nextEnergy += 1;
    nextMana += 0.6;
  } else if (action === "wait") {
    nextEnergy += 2;
    nextMana += 0.2;
  } else if (action === "enemyChoice") {
    nextEnergy += 2;
    nextMana += 0.2;
  } else if (isSpellAction(action) && nextMana >= MIN_SPELL_MANA) {
    wasFullSpell = nextMana >= MAX_MANA - EPS;
    nextMana = -clamp(nextMana, 0, MAX_MANA) / 2;
  }

  return {
    energy: clamp(nextEnergy, 0, MAX_ENERGY),
    mana: clamp(nextMana, -MAX_MANA / 2, MAX_MANA),
    combo: nextCombo,
    wasFullSpell,
  };
}

function isSpellAction(action) {
  return action === "spellHeal" || action === "spellEnergy" || action === "spellEmpower";
}

function canUseSpellNow() {
  return state.player.mana >= MIN_SPELL_MANA;
}

function spellNeedsTwoSlots() {
  return state.player.mana >= MAX_MANA - EPS;
}

function getChoiceSource(index = state.activeIndex) {
  for (let i = index - 1; i >= 0; i -= 1) {
    if (state.plan[i] === "choice") continue;
    return state.plan[i];
  }
  return null;
}

function canUseTwoSlotChoice() {
  return getChoiceSource() === "deepPredict" && state.activeIndex < PLAN_LENGTH - 1 && state.plan[state.activeIndex + 1] === "choice";
}

function renderSlots(activeIndex = state.activeIndex) {
  els.sequenceSlots.innerHTML = "";
  for (let i = 0; i < PLAN_LENGTH; i += 1) {
    const slot = document.createElement("div");
    const action = state.plan[i];
    slot.className = `slot${action ? ` filled ${action}` : ""}${i === activeIndex ? " active" : ""}`;
    slot.textContent = action ? ACTIONS[action].short : i + 1;
    els.sequenceSlots.appendChild(slot);
  }
  els.slotCounter.textContent = `${state.plan.length} / ${PLAN_LENGTH}`;
  els.startRound.disabled = state.plan.length !== PLAN_LENGTH || state.running || isGameOver();
}

function renderStats() {
  renderFighterStats("player", state.player);
  renderFighterStats("enemy", state.enemy);
}

function renderFighterStats(side, fighter) {
  const hpText = side === "player" ? els.playerHpText : els.enemyHpText;
  const energyText = side === "player" ? els.playerEnergyText : els.enemyEnergyText;
  const manaText = side === "player" ? els.playerManaText : els.enemyManaText;
  const hpBar = side === "player" ? els.playerHpBar : els.enemyHpBar;
  const energyBar = side === "player" ? els.playerEnergyBar : els.enemyEnergyBar;
  const manaBar = side === "player" ? els.playerManaBar : els.enemyManaBar;
  const status = side === "player" ? els.playerStatus : els.enemyStatus;

  hpText.textContent = `${fmt(fighter.hp)} / ${MAX_HP}${fighter.tempHp > 0 ? ` +${fmt(fighter.tempHp)}` : ""}`;
  energyText.textContent = `${fmt(fighter.energy)} / ${MAX_ENERGY}`;
  manaText.textContent = `${fmt(fighter.mana)} / ${MAX_MANA}`;
  hpBar.style.width = `${(fighter.hp / MAX_HP) * 100}%`;
  energyBar.style.width = `${(fighter.energy / MAX_ENERGY) * 100}%`;
  manaBar.style.width = `${((fighter.mana + MAX_MANA / 2) / (MAX_MANA + MAX_MANA / 2)) * 100}%`;

  const statuses = [`Комбо: ${fighter.combo}`];
  if (fighter.tempHp > 0) statuses.push(`врем. хиты ${fmt(fighter.tempHp)}`);
  if (fighter.empowerCharges > 0) statuses.push(`усиление ${fighter.empowerCharges}`);
  if (fighter.roundEmpower) statuses.push("усиление раунда");
  if (fighter.nextRoundEmpower) statuses.push("усиление в след. раунде");
  if (fighter.pendingSpell) statuses.push("каст");
  status.textContent = statuses.join(" | ");
}

function renderPhase() {
  const phaseText = state.phase === "prep" ? "Подготовка" : state.phase === "round" ? "Раунд" : "Бой окончен";
  els.phaseLabel.textContent = phaseText;
  els.roundStep.textContent = state.phase === "round" ? `${state.activeIndex + 1} / ${PLAN_LENGTH}` : "-";
  els.nextStep.disabled = state.phase !== "round" || state.awaitingChoice || isGameOver();
  els.undoAction.disabled = state.running || state.plan.length === 0;
  els.clearPlan.disabled = state.running || state.plan.length === 0;
  els.plannerHint.textContent = state.awaitingChoice ? "Выбери ответный ход" : "Выбери 6 действий";

  [...els.actionButtons.querySelectorAll("button")].forEach((button) => {
    const action = button.dataset.action;
    button.disabled = shouldDisableActionButton(action);
  });
}

function shouldDisableActionButton(action) {
  if (isGameOver()) return true;
  if (state.awaitingChoice) {
    if (action === "predict" || action === "deepPredict") return true;
    if (isSpellAction(action) && !canUseSpellNow()) return true;
    if ((action === "relax" || (isSpellAction(action) && spellNeedsTwoSlots())) && !canUseTwoSlotChoice()) return true;
    return false;
  }
  if (state.running) return true;

  const remaining = PLAN_LENGTH - state.plan.length;
  if (isSpellAction(action)) {
    if (!canUseSpellNow()) return true;
    return spellNeedsTwoSlots() ? remaining < 2 : remaining < 1;
  }
  if (action === "predict") return remaining < 2;
  if (action === "deepPredict") return remaining < 3;
  if (action === "relax") return remaining < 2;
  return remaining < 1;
}

function log(message, important = false) {
  const entry = document.createElement("div");
  entry.className = `log-entry${important ? " important" : ""}`;
  entry.textContent = message;
  els.battleLog.prepend(entry);
}

function showEffect(side, text) {
  const bubble = side === "player" ? els.playerEffect : els.enemyEffect;
  bubble.textContent = text;
  bubble.classList.remove("show");
  void bubble.offsetWidth;
  bubble.classList.add("show");
}

function animate(fighterEl, actionClass) {
  fighterEl.classList.remove(
    "attack-anim",
    "power-anim",
    "fullBlock-anim",
    "partialBlock-anim",
    "rest-anim",
    "meditate-anim",
    "predict-anim",
    "spell-anim",
    "protect-anim",
    "wait-anim",
    "hit-anim",
  );
  void fighterEl.offsetWidth;
  fighterEl.classList.add(actionClass);
  window.setTimeout(() => fighterEl.classList.remove(actionClass), 900);
}

function animateAction(side, result) {
  const fighter = side === "player" ? els.playerFighter : els.enemyFighter;
  const map = {
    attack: "attack-anim",
    powerAttack: "power-anim",
    fullBlock: "fullBlock-anim",
    partialBlock: "partialBlock-anim",
    protect: "protect-anim",
    predict: "predict-anim",
    deepPredict: "predict-anim",
    rest: "rest-anim",
    relax: "rest-anim",
    relaxHold: "rest-anim",
    meditate: "meditate-anim",
    wait: "wait-anim",
    spellHeal: "spell-anim",
    spellEnergy: "spell-anim",
    spellEmpower: "spell-anim",
    spellStart: "spell-anim",
    spellHold: "spell-anim",
  };
  animate(fighter, map[result.action] || "wait-anim");
}

function animateHit(side) {
  animate(side === "player" ? els.playerFighter : els.enemyFighter, "hit-anim");
  els.clashText.classList.remove("flash");
  void els.clashText.offsetWidth;
  els.clashText.classList.add("flash");
  window.setTimeout(() => els.clashText.classList.remove("flash"), 460);
}

function isGameOver() {
  return state.player.hp <= 0 || state.enemy.hp <= 0;
}

function startRound() {
  if (state.running || state.plan.length !== PLAN_LENGTH || isGameOver()) return;

  state.running = true;
  state.phase = "round";
  state.activeIndex = 0;
  state.awaitingChoice = false;
  state.enemyPlan = chooseEnemyPlan();
  state.player.roundEmpower = state.player.nextRoundEmpower;
  state.enemy.roundEmpower = state.enemy.nextRoundEmpower;
  state.player.nextRoundEmpower = false;
  state.enemy.nextRoundEmpower = false;
  els.playerCurrentAction.textContent = "-";
  els.enemyCurrentAction.textContent = "?";
  els.forecastText.textContent = "-";
  log("Раунд начался. Нажимай “Дальше”, чтобы разыгрывать действия по одному.", true);
  renderAll();
}

function nextStep() {
  if (state.phase !== "round" || state.awaitingChoice || isGameOver()) return;
  if (state.activeIndex < 0 || state.activeIndex >= PLAN_LENGTH) return;

  if (state.plan[state.activeIndex] === "choice" && !state.player.pendingSpell) {
    state.awaitingChoice = true;
    els.playerCurrentAction.textContent = "Выбери ответ";
    els.enemyCurrentAction.textContent = "?";
    log("Теперь выбери действие для ответного слота.", true);
    renderAll();
    return;
  }

  resolveStep(state.activeIndex);

  if (finishGameIfNeeded()) return;

  state.activeIndex += 1;
  if (state.activeIndex >= PLAN_LENGTH) {
    finishRound();
  }

  renderAll();
}

function resolveStep(index) {
  const playerPlanned = state.plan[index];
  let enemyPlanned = state.enemyPlan[index] || "wait";
  if (enemyPlanned === "enemyChoice" && !state.enemy.pendingSpell) {
    enemyPlanned = chooseEnemyResponse(playerPlanned, index);
    const canSpendNextChoice = index < PLAN_LENGTH - 1 && state.enemyPlan[index + 1] === "enemyChoice";
    if (enemyPlanned === "relax") {
      if (canSpendNextChoice) {
        state.enemyPlan[index + 1] = "relaxHold";
      } else {
        enemyPlanned = "rest";
      }
    }
    if (isSpellAction(enemyPlanned) && state.enemy.mana >= MAX_MANA - EPS) {
      if (canSpendNextChoice) {
        state.enemyPlan[index + 1] = "spellHold";
      } else {
        enemyPlanned = "wait";
      }
    }
    state.enemyPlan[index] = enemyPlanned;
  }
  const playerResult = prepareAction(state.player, playerPlanned, index);
  const enemyResult = prepareAction(state.enemy, enemyPlanned, index);

  const playerHit = resolveHit(state.player, state.enemy, playerResult, enemyResult);
  const enemyHit = resolveHit(state.enemy, state.player, enemyResult, playerResult);

  finalizeFighter(state.player, playerResult, index);
  finalizeFighter(state.enemy, enemyResult, index);

  els.playerCurrentAction.textContent = playerResult.label;
  els.enemyCurrentAction.textContent = enemyResult.label;

  updateForecast(index, playerResult, enemyResult);
  animateAction("player", playerResult);
  animateAction("enemy", enemyResult);
  if (enemyHit.dealt > 0) animateHit("player");
  if (playerHit.dealt > 0) animateHit("enemy");
  if (playerHit.dealt > 0) showEffect("enemy", `-${fmt(playerHit.dealt)}`);
  if (enemyHit.dealt > 0) showEffect("player", `-${fmt(enemyHit.dealt)}`);
  if (playerResult.applySpell || playerResult.finishSpell) showEffect("player", "✦");
  if (enemyResult.applySpell || enemyResult.finishSpell) showEffect("enemy", "✦");

  log(describeStep(index, playerResult, enemyResult, playerHit, enemyHit));
}

function chooseEnemyResponse(playerAction, index) {
  const randomSlip = Math.random() < 0.18;
  if (randomSlip) {
    return chooseEnemyAction("patient", state.enemy.energy, state.enemy.mana, state.enemy.combo, index);
  }

  if (isIncomingAttack(playerAction)) {
    if (state.enemy.tempHp > 0 && state.enemy.hp > 12) {
      if (state.enemy.energy >= 3 && Math.random() < 0.55) return "powerAttack";
      if (state.enemy.energy >= 1) return "attack";
      return "wait";
    }
    if (state.enemy.energy >= 3 && Math.random() < 0.45) return "protect";
    if (state.enemy.energy >= 1) return "fullBlock";
    if (state.enemy.energy >= 0.5) return "partialBlock";
    return "rest";
  }

  if (isVulnerableAction(playerAction)) {
    if (state.enemy.energy >= 3 && Math.random() < 0.55) return "powerAttack";
    if (state.enemy.energy >= 1) return "attack";
    return "wait";
  }

  if (playerAction === "fullBlock" || playerAction === "partialBlock" || playerAction === "protect") {
    if (state.enemy.mana < MIN_SPELL_MANA && Math.random() < 0.38) return "meditate";
    if (state.enemy.energy < 15 && Math.random() < 0.45) return "wait";
    return "rest";
  }

  if (state.enemy.mana >= MIN_SPELL_MANA && state.enemy.hp < 22 && Math.random() < 0.35) return "spellHeal";
  if (state.enemy.energy < 8) return "relax";
  return state.enemy.energy >= 3 && Math.random() < 0.3 ? "powerAttack" : "attack";
}

function isIncomingAttack(action) {
  return action === "attack" || action === "powerAttack";
}

function isVulnerableAction(action) {
  return action === "rest" || action === "relax" || action === "relaxHold" || action === "meditate" || action === "predict" || action === "deepPredict" || isSpellAction(action) || action === "spellHold";
}

function updateForecast(index, playerResult, enemyResult) {
  if (!playerResult.revealCount) {
    els.forecastText.textContent = "-";
    return;
  }

  if (enemyResult.action === "predict" || enemyResult.action === "deepPredict") {
    els.forecastText.textContent = "?";
    return;
  }

  const revealed = [];
  for (let offset = 1; offset <= playerResult.revealCount; offset += 1) {
    const action = state.enemyPlan[index + offset];
    if (action) revealed.push(`${index + offset + 1}: ${actionText(action)}`);
  }
  els.forecastText.textContent = revealed.length ? revealed.join(" | ") : "Нет будущих ходов";
}

function describeStep(index, playerResult, enemyResult, playerHit, enemyHit) {
  const parts = [`Ход ${index + 1}: ты - ${playerResult.label}, враг - ${enemyResult.label}.`];
  describeHit("Ты", playerHit, parts);
  describeHit("Враг", enemyHit, parts);
  if (playerResult.notes.length) parts.push(`Твоё действие: ${playerResult.notes.join(", ")}.`);
  if (enemyResult.notes.length) parts.push(`Действие врага: ${enemyResult.notes.join(", ")}.`);
  if (playerHit.dealt === 0 && enemyHit.dealt === 0 && !playerHit.energyBlocked && !enemyHit.energyBlocked && !playerHit.partialBlocked && !enemyHit.partialBlocked) {
    parts.push("Без попаданий.");
  }
  return parts.join(" ");
}

function describeHit(attackerName, hit, parts) {
  if (hit.empowered) parts.push(`${attackerName} ударил с усилением.`);
  if (hit.energyBlocked > 0) parts.push(`${attackerName} сжёг блоком ${fmt(hit.energyBlocked)} энергии.`);
  if (hit.partialBlocked > 0) parts.push(`${attackerName}: частичный блок снял ${fmt(hit.partialBlocked)} урона.`);
  if (hit.tempBlocked > 0) parts.push(`${attackerName}: временные хиты поглотили ${fmt(hit.tempBlocked)}.`);
  if (hit.dealt > 0) parts.push(`${attackerName} нанёс ${fmt(hit.dealt)} урона.`);
  if (hit.notes.length) parts.push(hit.notes.join(", ") + ".");
}

function finishRound() {
  state.running = false;
  state.phase = "prep";
  state.activeIndex = -1;
  state.awaitingChoice = false;
  state.plan = [];
  state.enemyPlan = [];
  state.player.roundEmpower = false;
  state.enemy.roundEmpower = false;
  els.playerCurrentAction.textContent = "-";
  els.enemyCurrentAction.textContent = "?";
  els.forecastText.textContent = "-";
  log("Раунд завершён. Собери новый план.", true);
}

function finishGameIfNeeded() {
  if (!isGameOver()) return false;
  state.running = false;
  state.phase = "gameover";
  state.activeIndex = -1;
  state.awaitingChoice = false;
  els.nextStep.disabled = true;

  if (state.player.hp <= 0 && state.enemy.hp <= 0) {
    els.phaseLabel.textContent = "Ничья";
    log("Оба воина упали одновременно. Ничья.", true);
  } else if (state.enemy.hp <= 0) {
    els.phaseLabel.textContent = "Победа";
    log("Победа. Противник выбит из боя.", true);
  } else {
    els.phaseLabel.textContent = "Поражение";
    log("Поражение. Твой воин выбит из боя.", true);
  }
  renderAll();
  return true;
}

function addAction(action) {
  if (state.awaitingChoice) {
    chooseRoundAction(action);
    return;
  }

  if (state.running || state.plan.length >= PLAN_LENGTH || isGameOver()) return;

  if (isSpellAction(action)) {
    if (!canUseSpellNow()) return;
    if (spellNeedsTwoSlots()) {
      if (PLAN_LENGTH - state.plan.length < 2) return;
      state.plan.push(action, "spellHold");
    } else {
      state.plan.push(action);
    }
  } else if (action === "predict") {
    if (PLAN_LENGTH - state.plan.length < 2) return;
    state.plan.push("predict", "choice");
  } else if (action === "deepPredict") {
    if (PLAN_LENGTH - state.plan.length < 3) return;
    state.plan.push("deepPredict", "choice", "choice");
  } else if (action === "relax") {
    if (PLAN_LENGTH - state.plan.length < 2) return;
    state.plan.push("relax", "relaxHold");
  } else {
    state.plan.push(action);
  }
  renderAll();
}

function chooseRoundAction(action) {
  if (!state.awaitingChoice || action === "predict" || action === "deepPredict") return;
  if (isSpellAction(action) && !canUseSpellNow()) return;

  const needsTwoSlots = action === "relax" || (isSpellAction(action) && spellNeedsTwoSlots());
  if (needsTwoSlots && !canUseTwoSlotChoice()) return;

  state.plan[state.activeIndex] = action;
  if (needsTwoSlots) {
    state.plan[state.activeIndex + 1] = action === "relax" ? "relaxHold" : "spellHold";
  }
  state.awaitingChoice = false;
  els.playerCurrentAction.textContent = actionText(action);
  log(`Ответ выбран: ${actionText(action)}. Нажми “Дальше”, чтобы разыграть ход.`, true);
  renderAll();
}

function undoAction() {
  if (state.running || state.plan.length === 0) return;
  const removed = state.plan.pop();
  if (removed === "choice") {
    while (state.plan[state.plan.length - 1] === "choice") {
      state.plan.pop();
    }
    if (state.plan[state.plan.length - 1] === "predict" || state.plan[state.plan.length - 1] === "deepPredict") {
      state.plan.pop();
    }
  }
  while (state.plan[state.plan.length - 1] === "choice" && state.plan.length > 0) {
    state.plan.pop();
  }
  renderAll();
}

function clearPlan() {
  if (state.running) return;
  state.plan = [];
  renderAll();
}

function resetGame() {
  state.phase = "prep";
  state.player = makeFighter("Ты");
  state.enemy = makeFighter("Противник");
  state.plan = [];
  state.enemyPlan = [];
  state.activeIndex = -1;
  state.awaitingChoice = false;
  state.running = false;
  els.playerCurrentAction.textContent = "-";
  els.enemyCurrentAction.textContent = "?";
  els.forecastText.textContent = "-";
  els.battleLog.innerHTML = "";
  log("Новый бой. Мана начинается с 2.5: до полной ульты нужно дожить.", true);
  renderAll();
}

function renderAll() {
  renderStats();
  renderSlots();
  renderPhase();
}

els.actionButtons.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  addAction(button.dataset.action);
});

els.undoAction.addEventListener("click", undoAction);
els.clearPlan.addEventListener("click", clearPlan);
els.startRound.addEventListener("click", startRound);
els.nextStep.addEventListener("click", nextStep);
els.newGame.addEventListener("click", resetGame);

resetGame();
