# DocVQA PDF Files

Place the 20 DocVQA PDF files in this directory:

- `doc_0000.pdf`
- `doc_0001.pdf`
- `doc_0002.pdf`
- `doc_0003.pdf`
- ...
- `doc_0019.pdf`

These files correspond to the test cases in `public/data/docvqa-annotations.json`.

## Running the Benchmark

Once PDFs are in place, run:

```bash
npm run benchmark
```

This will:
1. Ingest all PDFs through Pipeline A-Hybrid
2. Query the agent with test questions
3. Evaluate responses using LLM-as-a-Judge
4. Generate accuracy report in `tests/docvqa/report.md`
