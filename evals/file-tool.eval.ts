import { evaluate } from "@lmnr-ai/lmnr";
import { toolSelectionScore } from "./evaluators.ts";

import type { EvalData, EvalTarget } from "./types.ts";
import dataSet from "./data/file-tools.json" with { type: "json" };
import { singleTurnExecutorWithMocks } from './executors.ts';

const executor = async (data: EvalData) => {
    return await singleTurnExecutorWithMocks(data);
}

evaluate({
    data: dataSet as any,
    executor,
    evaluators: {
        selectionScore: (output: any, target: any) => {
            if(target?.category === 'secondary') return 1;

            return toolSelectionScore(output, target);
        }
    }
})

// npx tsx evals/file-tools.eval.ts