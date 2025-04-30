
type ChangeHandler = (change: any) => void;

export async function listenForDocumentChangesNOTUSING(
  dbUrl: string,
  docId: string,
  onChange: ChangeHandler
) {
  const url = new URL(`${dbUrl}/_changes`);
  url.searchParams.set('feed', 'continuous');
  url.searchParams.set('include_docs', 'true');
  url.searchParams.set('since', 'now');
  url.searchParams.set('filter', '_doc_ids');
  
  const body = JSON.stringify({ doc_ids: [docId] });

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body,
  });

  if (!response.body) {
    throw new Error('No response body from CouchDB');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    
    let lines = buffer.split('\n');
    buffer = lines.pop() || ''; // Last incomplete line stays in buffer

    for (const line of lines) {
      if (line.trim()) {
        try {
          const change = JSON.parse(line);
          onChange(change);
        } catch (e) {
          console.error('Failed to parse change line:', line, e);
        }
      }
    }
  }
}
