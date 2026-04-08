# Agent Memory Systems — Deep Research (April 2026)

## Key Industry Findings

### Memory Decay Problem
- 33% of stored facts become incorrect within 90 days (Mem0 research)
- A-MemGuard framework cuts memory poisoning by 95% using consensus-based validation

### Four Dominant Architectures
1. **RAG+Hybrid Retrieval** — BM25 + vector search combined
2. **Observational Memory** — background observer/reflector agents extract and compress
3. **Self-Editing Memory** — agents call edit_memory/archive_memory as tools (Letta pattern)
4. **Graph Memory** — temporal knowledge graphs with entity/relationship extraction

### Google's Always On Memory Agent (March 2026)
- No vector database — plain SQLite
- LLM-driven consolidation every 30 minutes ("sleep" pattern)
- LLM identifies relevant memories at query time
- Proves you don't need embeddings for small-to-medium stores

### Production Four-Layer Model
1. **Working Memory** — in-context, under 2K tokens
2. **Episodic Memory** — recent interactions as structured JSON
3. **Semantic Memory** — long-term facts with scheduled consolidation
4. **Procedural Memory** — successful workflow traces as templates (30-50% fewer planning errors)

### Compaction vs Summarization
- Summarization (80-90% compression) introduces hallucination — file paths get paraphrased
- Verbatim compaction (50-70% compression) preserves every surviving character
- Best trigger: compact at 80% capacity, not 95%
- Optimal ratio: keep 30%, drop 70% (Morph defaults)

### Retrieval
- BM25 is faster, cheaper, deterministic, no GPU needed
- Vector search wins on semantic similarity only
- Hybrid (BM25 + vectors) improves recall 15-30% over either alone
- Supabase tsvector + GIN indexes good enough for small scale
- Add pgvector only when users report missed recall

### Trust Score Formula
```
score = freshness(0.25) + specificity(0.25) + access_frequency(0.20) + importance(0.15) + source_reliability(0.15)
```

### Quality Heuristic
- High quality: specific (names, dates, numbers), actionable, temporally bounded
- Noise: vague sentiment, transient small talk, redundant restatements

### Failure Modes
1. Unbounded growth causing retrieval noise
2. Stale memories (file paths from weeks ago)
3. Context poisoning (hallucinated info enters memory, compounds)
4. All temporal contexts treated the same
5. Multi-agent duplication

## What We Implemented

### memoryConsolidation.ts
- Trust scoring with freshness decay, specificity detection, access frequency
- Staleness detection (90-day threshold)
- Contradiction detection using keyword overlap + negation patterns
- Consolidation ("sleep" pattern) — merges similar memories by keyword similarity
- Quality gate — rejects noise before saving
- Procedural memory — saves successful workflow traces
- Memory health report — trust %, stale count, contradiction risk

### Integration
- Quality gate added to autoExtractAndSave — rejects low-quality candidates
- Consolidation runs automatically after each extraction
- Health stats shown in MemoryViewer (trust %, stale, conflict risk)
- CONSOLIDATE button for manual cleanup

## Sources
- State of AI Agent Memory 2026: https://mem0.ai/blog/state-of-ai-agent-memory-2026
- 6 Best AI Agent Memory Frameworks: https://machinelearningmastery.com/the-6-best-ai-agent-memory-frameworks-you-should-try-in-2026/
- Google Always On Memory Agent: https://github.com/GoogleCloudPlatform/generative-ai/tree/main/gemini/agents/always-on-memory-agent
- A-MemGuard Defense Framework: https://arxiv.org/abs/2510.02373
- Claude Compaction API: https://platform.claude.com/docs/en/build-with-claude/compaction
- Compaction vs Summarization: https://www.morphllm.com/compaction-vs-summarization
- Agent Memory in Production: https://mindra.co/blog/agent-memory-and-state-management-in-production
- Mem0 Paper: https://arxiv.org/html/2504.19413v1
- Supabase Hybrid Search: https://supabase.com/docs/guides/ai/hybrid-search
- BM25 vs Vector Search: https://aloknecessary.github.io/blogs/bm25_vs_vector_search/
- Microsoft Foundry User-Scoped Memory: https://techcommunity.microsoft.com/blog/azure-ai-foundry-blog
