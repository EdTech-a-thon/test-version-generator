import { Worker } from "node:worker_threads";

const EXPRESSION_TIMEOUT_MS = 250;
const BLOCKED_FUNCTIONS = [
  "import",
  "createUnit",
  "evaluate",
  "parse",
  "simplify",
  "derivative",
  "function",
];

const workerSource = String.raw`
  const { parentPort, workerData } = require("node:worker_threads");
  const { create, all } = require("mathjs");
  const math = create(all);
  const safeEvaluate = math.evaluate;
  const blocked = Object.fromEntries(
    workerData.blocked.map((name) => [name, () => { throw new Error("Function " + name + " is disabled"); }]),
  );
  math.import(blocked, { override: true });
  parentPort.postMessage({ ready: true });

  parentPort.on("message", ({ id, expression, scope }) => {
    try {
      parentPort.postMessage({ id, result: safeEvaluate(expression, scope) });
    } catch (error) {
      parentPort.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
    }
  });
`;

type PendingExpression = {
  expression: string;
  variables: Record<string, number>;
  resolve: (value: number) => void;
  reject: (error: Error) => void;
};

function validateScalar(value: unknown): number {
  if (typeof value !== "number") throw new Error("Expression result must be a real scalar number");
  if (!Number.isFinite(value)) throw new Error("Expression result must be finite");
  if (Math.abs(value) > 1e12) throw new Error("Expression result exceeds the allowed magnitude");
  return value;
}

class ExpressionWorker {
  private worker: Worker | undefined;
  private ready = false;
  private active: PendingExpression | undefined;
  private queue: PendingExpression[] = [];
  private nextId = 1;
  private activeId = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private startupTimer: ReturnType<typeof setTimeout> | undefined;

  evaluate(expression: string, variables: Record<string, number>): Promise<number> {
    return new Promise((resolve, reject) => {
      this.queue.push({ expression, variables, resolve, reject });
      this.ensureWorker();
      this.runNext();
    });
  }

  private ensureWorker(): void {
    if (this.worker) return;
    this.ready = false;
    const worker = new Worker(workerSource, { eval: true, workerData: { blocked: BLOCKED_FUNCTIONS } });
    this.worker = worker;
    this.startupTimer = setTimeout(
      () => this.replaceWorker(worker, new Error("Expression worker failed to start")),
      5_000,
    );
    worker.on("message", (message: { ready?: boolean; id?: number; result?: unknown; error?: string }) => {
      if (worker !== this.worker) return;
      if (message.ready) {
        if (this.startupTimer) clearTimeout(this.startupTimer);
        this.startupTimer = undefined;
        this.ready = true;
        this.runNext();
        return;
      }
      if (message.id !== this.activeId || !this.active) return;
      const active = this.active;
      this.clearActive();
      if (message.error) active.reject(new Error(message.error));
      else {
        try {
          active.resolve(validateScalar(message.result));
        } catch (error) {
          active.reject(error instanceof Error ? error : new Error(String(error)));
        }
      }
      this.runNext();
    });
    worker.on("error", (error) => this.replaceWorker(worker, error));
    worker.on("exit", (code) => {
      if (worker === this.worker && code !== 0) {
        this.replaceWorker(worker, new Error(`Expression worker exited with code ${code}`));
      }
    });
  }

  private runNext(): void {
    if (!this.ready || !this.worker || this.active || this.queue.length === 0) return;
    this.active = this.queue.shift();
    this.activeId = this.nextId++;
    this.worker.postMessage({
      id: this.activeId,
      expression: this.active!.expression,
      scope: this.active!.variables,
    });
    this.timer = setTimeout(() => {
      const active = this.active;
      if (!active) return;
      this.clearActive();
      active.reject(new Error(`Expression timed out after ${EXPRESSION_TIMEOUT_MS}ms`));
      this.replaceWorker(this.worker!, undefined);
    }, EXPRESSION_TIMEOUT_MS);
  }

  private clearActive(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.active = undefined;
  }

  private replaceWorker(worker: Worker, error?: Error): void {
    if (worker !== this.worker) return;
    void worker.terminate();
    if (this.startupTimer) clearTimeout(this.startupTimer);
    this.startupTimer = undefined;
    this.worker = undefined;
    this.ready = false;
    if (this.active) {
      const active = this.active;
      this.clearActive();
      active.reject(error ?? new Error("Expression worker stopped"));
    }
    this.ensureWorker();
  }
}

const expressionWorker = new ExpressionWorker();

export async function evaluateExpression(
  expression: string,
  variables: Record<string, number> = {},
): Promise<number> {
  if (BLOCKED_FUNCTIONS.some((name) => new RegExp(`\\b${name}\\s*\\(`).test(expression))) {
    throw new Error("This expression uses a disabled function");
  }
  return expressionWorker.evaluate(expression, variables);
}

export function createExpressionEvaluator(): (
  expression: string,
  variables?: Record<string, number>,
) => Promise<number> {
  const worker = new ExpressionWorker();
  return (expression, variables = {}) => worker.evaluate(expression, variables);
}
