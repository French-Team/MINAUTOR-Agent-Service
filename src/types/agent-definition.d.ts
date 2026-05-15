export interface AgentDefinition {
    id: string;
    displayName: string;
    model: string;
    instructionsPrompt: string;
    toolNames: string[];
    spawnerPrompt?: string;
    spawnableAgents?: string[];
    handleSteps?: (context: AgentStepContext) => Generator<ToolCall | 'STEP' | 'STEP_ALL', void, unknown>;
}
export interface AgentState {
    agentId: string;
    runId: string;
    parentId: string | undefined;
    messageHistory: Message[];
    output: Record<string, unknown> | undefined;
    systemPrompt: string;
    toolDefinitions: Record<string, {
        description: string | undefined;
        inputSchema: Record<string, unknown>;
    }>;
}
export interface AgentStepContext {
    agentState: AgentState;
    prompt?: string;
    params?: Record<string, unknown>;
}
export interface ToolCall {
    toolName: string;
    input: Record<string, unknown>;
    includeToolCall?: boolean;
}
export type TextPart = {
    type: 'text';
    text: string;
};
export type ToolCallPart = {
    type: 'tool-call';
    toolCallId: string;
    toolName: string;
    input: Record<string, unknown>;
};
export type ToolResultPart = {
    type: 'tool-result';
    toolCallId: string;
    toolName: string;
    content: string;
};
export type Message = {
    role: 'system';
    content: TextPart[];
} | {
    role: 'user';
    content: (TextPart)[];
} | {
    role: 'assistant';
    content: (TextPart | ToolCallPart)[];
} | {
    role: 'tool';
    toolCallId: string;
    toolName: string;
    content: ToolResultPart[];
};
