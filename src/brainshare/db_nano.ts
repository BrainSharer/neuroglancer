export interface CouchDbChange {
    id: string;
    seq: string;
    changes: { rev: string }[];
    deleted?: boolean;
    doc?: any;
  }
  
  interface ListenOptions {
    dbUrl: string;
    docId: string;
    since?: string; // Optional: start listening from a specific sequence
    onChange: (change: CouchDbChange) => void;
    onError?: (error: any) => void;
  }

export function listenToDocumentChanges(options: ListenOptions) {
    const { dbUrl, docId, since = 'now', onChange, onError } = options;
    console.log(`Listening to changes for document ${docId} in database ${dbUrl}`);
  
    const url = new URL(`${dbUrl}/_changes`);
    url.searchParams.append('feed', 'continuous');
    url.searchParams.append('include_docs', 'true');
    url.searchParams.append('filter', '_doc_ids');
    url.searchParams.append('since', since);
    const body = JSON.stringify({ doc_ids: [docId] });
  
    const controller = new AbortController();
    const signal = controller.signal;
  
    fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body,
      signal,
    })
      .then(async (response) => {
        if (!response.body) {
          throw new Error('No response body.');
        }
  
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
  
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n').filter((line) => line.trim() !== '');
            for (const line of lines) {
              try {
                const change: CouchDbChange = JSON.parse(line);
                onChange(change);
              } catch (err) {
                if (onError) onError(err);
              }
            }
          }
        }
      })
      .catch((error) => {
        if (onError) onError(error);
      });
  
    return () => {
      controller.abort(); // Allow stopping the listener
    };
  }