import type { LLMMessage } from '../llm/types.js';

/**
 * Conversation State Manager — maintains multi-turn context within a REPL session
 */
export class ConversationManager {
    private messages: LLMMessage[] = [];
    private systemPrompt: string;
    private turnCount = 0;

    constructor(systemPrompt: string) {
        this.systemPrompt = systemPrompt;
        this.messages.push({ role: 'system', content: systemPrompt });
    }

    /**
     * Add a user message
     */
    addUser(content: string): void {
        this.messages.push({ role: 'user', content });
        this.turnCount++;
    }

    /**
     * Add an assistant message
     */
    addAssistant(content: string, toolCalls?: LLMMessage['toolCalls']): void {
        this.messages.push({ role: 'assistant', content, toolCalls });
    }

    /**
     * Add a tool result
     */
    addToolResult(content: string, toolCallId: string): void {
        this.messages.push({ role: 'tool', content, toolCallId });
    }

    /**
     * Get all messages for the LLM
     */
    getMessages(): LLMMessage[] {
        return [...this.messages];
    }

    /**
     * Current turn count
     */
    get turns(): number {
        return this.turnCount;
    }

    /**
     * Compact the conversation — keep system prompt + last N turns
     */
    compact(keepTurns = 4): void {
        const system = this.messages[0];
        const recent: LLMMessage[] = [];
        let turnsSeen = 0;

        // Walk backwards to collect recent turns
        for (let i = this.messages.length - 1; i >= 1; i--) {
            const msg = this.messages[i];
            if (msg.role === 'user') turnsSeen++;
            recent.unshift(msg);
            if (turnsSeen >= keepTurns) break;
        }

        this.messages = [system, ...recent];
    }

    /**
     * Reset conversation
     */
    reset(): void {
        this.messages = [{ role: 'system', content: this.systemPrompt }];
        this.turnCount = 0;
    }
}
