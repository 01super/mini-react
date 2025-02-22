// !实现一个单线程的任务调度器

import { getCurrentTime } from "shared/utils";
import {
  IdlePriority,
  ImmediatePriority,
  LowPriority,
  NoPriority,
  NormalPriority,
  PriorityLevel,
  UserBlockingPriority,
} from "./SchedulerPriorities";
import { peek, pop, push } from "./SchedulerMinHeap";
import {
  userBlockingPriorityTimeout,
  maxSigned31BitInt,
  lowPriorityTimeout,
  normalPriorityTimeout,
} from "./SchedulerFeatureFlags";
import { getCurrentTime } from "../../shared/utils";

type Callback = (arg: boolean) => Callback | null | undefined;

// callback 是任务的初始值
// 一个时间单元内可执行多个 task，将这些 task 称为 work
export type Task = {
  id: number;
  callback: Callback | null;
  priorityLevel: PriorityLevel;
  startTime: number;
  expirationTime: number;
  sortIndex: number;
};

/**
 * !任务池
 * 动态的 最小堆结构
 */
const taskQueue: Task[] = [];

let taskIdCounter = 1;

let currentTask: Task | null = null;
let currentPriorityLevel: PriorityLevel = NoPriority;

/**
 * !记录时间切片的起始值，时间戳
 */
let startTime = -1;

/**
 * !时间切片的时长，这是个时间段
 */
let frameInterval = 5;

/**
 * !是否有 work 在执行，锁，防止重复调度
 */
let isPerformingWork = false;

/**
 * !主线程是否在调度
 */
let isHostCallbackScheduled = false;

let isMessageLoopRunning = false;

/**
 * !将控制权交还给主线程的判断
 */
function shouldYieldToHost() {
  // 当前时间切片的时长
  const timeElapsed = getCurrentTime() - startTime;

  if (timeElapsed < frameInterval) {
    return false;
  }

  return true;
}

// !任务调度器的入口函数
function scheduleCallback(priorityLevel: PriorityLevel, callback: Callback) {
  const currentTime = getCurrentTime();
  let timeout: number;
  switch (priorityLevel) {
    case ImmediatePriority:
      // 立即超时
      timeout = -1;
      break;
    case UserBlockingPriority:
      // 最终超时
      timeout = userBlockingPriorityTimeout;
      break;
    case IdlePriority:
      // 永不超时
      timeout = maxSigned31BitInt;
      break;
    case LowPriority:
      // 最终超时
      timeout = lowPriorityTimeout;
      break;
    case NormalPriority:
    default:
      timeout = normalPriorityTimeout;
      break;
  }
  const expirationTime = currentTime + timeout;

  const newTask: Task = {
    id: taskIdCounter++,
    callback,
    priorityLevel,
    startTime: getCurrentTime(),
    expirationTime,
    sortIndex: -1,
  };
  newTask.sortIndex = expirationTime;
  push(taskQueue, newTask);
}
// 实现requestIdleCallback的功能
// 宏任务来实现异步任务队列，以实现异步更新
function requestHostCallback(callback: Callback) {
  if (!isMessageLoopRunning) {
    isMessageLoopRunning = true;
    schedulePerformWorkUntilDeadline();
  }
}

function performWorkUntilDeadline() {
  if (isMessageLoopRunning) {
    const currentTime = getCurrentTime();
    startTime = currentTime;
    let hasMoreWork = true;
    try {
      hasMoreWork = flushWork(currentTime);
    } finally {
      if (hasMoreWork) {
        schedulePerformWorkUntilDeadline();
      } else {
        isMessageLoopRunning = false;
      }
    }
  }
}

function flushWork(initialTIme: number) {
  isHostCallbackScheduled = false;
  isPerformingWork = true;
  let previousPriorityLevel = currentPriorityLevel;
  try {
    return workLoop(initialTIme);
  } finally {
    currentTask = null;
    currentPriorityLevel = previousPriorityLevel;
    isPerformingWork = false;
  }
}

const channel = new MessageChannel();
const port = channel.port2;
channel.port1.onmessage = performWorkUntilDeadline;

function schedulePerformWorkUntilDeadline() {
  port.postMessage(null);
}

// !取消某个任务
// 由于最小堆没法直接删除，只能初步将 task.callback 置为 null
// 调度过程中，当这个任务位于堆顶时，便可删掉
function cancenCallBack() {
  currentTask?.callback && (currentTask.callback = null);
}

function getCurrentPriorityLevel(): PriorityLevel {
  return currentPriorityLevel;
}

// 有很多 task，每一个 task 都有一个 callback，callback 执行完会执行下一个 task
// 一个 work 就是一个时间切片内执行的一些 task
// 时间切片要循环执行 work，直到 切片时间用完
// 返回值表示是否还有任务需要执行
function workLoop(initialTime: number): boolean {
  let currentTime = initialTime;
  currentTask = peek(taskQueue);
  while (currentTask !== null) {
    if (currentTask.expirationTime > currentTime && shouldYieldToHost()) {
      break;
    }
    const callback = currentTask.callback;
    if (typeof callback === "function") {
      // 有效任务
      currentTask.callback = null;
      currentPriorityLevel = currentTask.priorityLevel;
      const didUserCallbackTimeout = currentTask.expirationTime <= currentTime;
      const continuationCallback = callback(didUserCallbackTimeout);
      if (typeof continuationCallback === "function") {
        currentTask.callback = continuationCallback;
        return true;
      } else {
        if (currentTask === peek(taskQueue)) {
          pop(taskQueue);
        }
      }
    } else {
      // 无效任务
      pop(taskQueue);
    }
    currentTask = peek(taskQueue);
  }
  if (currentTask !== null) {
    return true;
  } else {
    return false;
  }
}

export { scheduleCallback as scheduleCallcack, getCurrentPriorityLevel };
