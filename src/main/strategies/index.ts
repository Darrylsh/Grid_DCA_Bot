// strategies/index.js
// Aggregates all strategies into a single map.
// Import from here anywhere you need the STRATEGIES object.
// To add a new strategy: create its file, require it here, and add it to the map.

import SNIPER from './sniper';
import HUNTER from './hunter';
import QUICK_EXIT from './quickexit';
import BOX from './box';

const STRATEGIES = {
    SNIPER,
    HUNTER,
    QUICK_EXIT,
    BOX
};

export default STRATEGIES;
