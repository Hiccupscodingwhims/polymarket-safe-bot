export default {
  NAME: "config3",

  SCANNER: {
    MAX_HOURS_TO_CLOSE: 3,
    MIN_PROBABILITY: 0.90,
    MAX_PROBABILITY: 0.96,
    MIN_LIQUIDITY_USD: 5
  },

  TRADER: {
    TOTAL_BUDGET: 30,
    STOP_PROB_DROP: 0.20 // 10%
  }
};