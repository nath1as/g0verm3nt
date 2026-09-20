import { lunaLogicTasks } from "./luna-logic-tasks.ts";
import { lunaStateTasks } from "./luna-state-tasks.ts";

export const lunaCalibrationTasks = Object.freeze([
  ...lunaLogicTasks,
  ...lunaStateTasks,
]);
