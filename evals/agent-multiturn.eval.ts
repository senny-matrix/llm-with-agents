import { evaluate } from '@lmnr-ai/lmnr';
import {toolOrderCorrect, toolsAvoided, llmJudge} from './evaluators';
import type {
    MultiTurnEvalData,
    MultiTurnDatasetEntry,
    MultiTurnResult,
    MultiTurnTarget
} from './types';

import dataset from './data/agent-multiturn.json' with {type: 'json'};

import {multiTurnWithMocks} from './executors.ts';

const executor = async (data: MultiTurnEvalData) => {
    return multiTurnWithMocks(data);
}

evaluate({
    data: dataset as any,
    executor,
    evaluators: {
        outputQuality: async (output:any, taget:any) => {
            if(!taget) return 1;
            return llmJudge(output, taget)
        },
    },
    config: {
        projectApiKey: process.env.LMR_API_KEY,
    },
    groupName: 'agent-multiturn',
})