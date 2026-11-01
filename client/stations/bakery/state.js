export const STAGES = Object.freeze([
  'waiting_order', 'order_received', 'ingredients_ready', 'product_shaped',
  'product_baked', 'product_ready', 'completed',
]);

export const OBJECTIVES = Object.freeze({
  waiting_order: 'Поговори с пекарем и получи заказ.',
  order_received: 'Подготовь ингредиенты у рабочей стойки.',
  ingredients_ready: 'Сформуй хлеб на рабочем столе.',
  product_shaped: 'Помести изделие в закрытую печь.',
  product_baked: 'Забери готовый хлеб с охлаждающей полки.',
  product_ready: 'Передай заказ пекарю.',
  completed: 'Заказ готов и передан!',
});

const TRANSITIONS = Object.freeze({
  get_order: Object.freeze({ from: 'waiting_order', to: 'order_received', feedback: 'Заказ получен. Начни с подготовки ингредиентов.' }),
  prepare_ingredients: Object.freeze({ from: 'order_received', to: 'ingredients_ready', feedback: 'Ингредиенты подготовлены. Можно формовать изделие.' }),
  shape_product: Object.freeze({ from: 'ingredients_ready', to: 'product_shaped', feedback: 'Хлеб сформован. Следующий шаг — закрытая печь.' }),
  use_oven: Object.freeze({ from: 'product_shaped', to: 'product_baked', feedback: 'Выпечка готова. Забери хлеб с полки.' }),
  collect_product: Object.freeze({ from: 'product_baked', to: 'product_ready', feedback: 'Хлеб у тебя. Отнеси заказ пекарю.' }),
  deliver_order: Object.freeze({ from: 'product_ready', to: 'completed', feedback: 'Заказ сдан. Отличная работа!' }),
});

export function createInitialState(completedOrders = 0) {
  return { stage: 'waiting_order', completedOrders };
}

export function applyBakeryAction(state, action) {
  if (action === 'repeat_order' && state.stage === 'completed') {
    return { state: createInitialState(state.completedOrders), accepted: true, feedback: 'Готов принять следующий заказ.' };
  }
  const transition = TRANSITIONS[action];
  if (!transition || state.stage !== transition.from) {
    return { state, accepted: false, feedback: `Сейчас: ${OBJECTIVES[state.stage] ?? OBJECTIVES.waiting_order}` };
  }
  const completedOrders = transition.to === 'completed' ? state.completedOrders + 1 : state.completedOrders;
  return {
    state: { stage: transition.to, completedOrders },
    accepted: true,
    feedback: transition.feedback,
  };
}

export function actionForStage(stage) {
  return Object.entries(TRANSITIONS).find(([, transition]) => transition.from === stage)?.[0]
    ?? (stage === 'completed' ? 'repeat_order' : null);
}
