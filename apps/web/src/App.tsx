import { useEffect, useState } from 'react';
import { StoreProvider, useStore } from './state/store.js';
import { AuthGate } from './components/AuthGate.js';
import { Header } from './components/Header.js';
import { Navigator } from './components/Navigator.js';
import { WriteView } from './components/WriteView.js';
import { WorldDetail } from './components/WorldDetail.js';
import { StudioChat, ChatRail } from './components/chat/StudioChat.js';
import { Toast } from './components/Toast.js';
import { auth } from './api/index.js';

export function App(): JSX.Element {
  return (
    <StoreProvider>
      <Root />
    </StoreProvider>
  );
}

function Root(): JSX.Element {
  const store = useStore();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        await auth.me();
        store.setAuthed(true);
      } catch {
        store.setAuthed(false);
      } finally {
        setChecking(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Once authed, load worlds and open the first (or create one).
  useEffect(() => {
    if (!store.authed) return;
    void (async () => {
      await store.refreshWorlds();
      if (store.worldList.length === 0) {
        await store.newWorld();
      } else if (!store.worldId) {
        await store.openWorld(store.worldList[0]!.id);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.authed]);

  if (checking) {
    return <div style={{ height: '100vh', background: '#0d0f0f' }} />;
  }
  if (!store.authed) {
    return <AuthGate onAuthed={() => store.setAuthed(true)} />;
  }
  return <Shell />;
}

function Shell(): JSX.Element {
  const store = useStore();
  const [chatOpen, setChatOpen] = useState(true);

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: '#0d0f0f',
        color: '#e9ecea',
        overflow: 'hidden',
      }}
    >
      <Header />
      <div style={{ display: 'flex', flex: '1 1 auto', minHeight: 0 }}>
        <Navigator />
        <main
          style={{
            flex: '1 1 auto',
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
            background: '#0d0f0f',
          }}
        >
          {store.view === 'world' && store.selectedNode ? <WorldDetail /> : <WriteView />}
        </main>
        {chatOpen ? (
          <StudioChat onCollapse={() => setChatOpen(false)} />
        ) : (
          <ChatRail onExpand={() => setChatOpen(true)} />
        )}
      </div>
      <Toast />
    </div>
  );
}
