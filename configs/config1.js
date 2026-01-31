export default {
  NAME: "config1",

  SCANNER: {
    MAX_HOURS_TO_CLOSE: 2,
    MIN_PROBABILITY: 0.85,
    MAX_PROBABILITY: 0.96,
    MIN_LIQUIDITY_USD: 10
  },

  TRADER: {
    TOTAL_BUDGET: 50,
    STOP_PROB_DROP: 0.15 // 3%
  }
};