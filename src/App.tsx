import { HashRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './state/AuthContext'
import { DataProvider, useData } from './state/DataContext'
import { CardsPage } from './pages/CardsPage'
import { CollectionPage } from './pages/CollectionPage'
import { DeckEditorPage } from './pages/DeckEditorPage'
import { DecksPage } from './pages/DecksPage'
import { LoginPage } from './pages/LoginPage'
import { SharePage } from './pages/SharePage'

function Shell() {
  const { user, signOut } = useAuth()
  const { error, clearError } = useData()
  return (
    <>
      <header className="topbar">
        <NavLink to="/" className="brand"><span>NC</span> Deckhand</NavLink>
        <nav>
          <NavLink to="/" end>Cartas</NavLink>
          <NavLink to="/decks">Mazos</NavLink>
          <NavLink to="/collection">Colección</NavLink>
        </nav>
        <div className="who">
          {user ? (
            <>
              <span className="muted small">{user.email}</span>
              <button className="btn sm" onClick={() => void signOut()}>Salir</button>
            </>
          ) : (
            <NavLink to="/login" className="btn sm primary">Iniciar sesión</NavLink>
          )}
        </div>
      </header>
      {error && (
        <div className="banner" role="alert">
          {error} <button className="btn sm" onClick={clearError}>Cerrar</button>
        </div>
      )}
      <main>
        <Routes>
          <Route path="/" element={<CardsPage />} />
          <Route path="/decks" element={<DecksPage />} />
          <Route path="/decks/:id" element={<DeckEditorPage />} />
          <Route path="/share/:code" element={<SharePage />} />
          <Route path="/collection" element={<CollectionPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <footer className="foot muted small">
        Herramienta de fans, no oficial. Datos e imágenes de cartas © sus respectivos propietarios (CD PROJEKT RED / Cyberpunk TCG). Catálogo obtenido de cyberpunk-tcg-sim.online.
      </footer>
    </>
  )
}

export default function App() {
  return (
    <HashRouter>
      <AuthProvider>
        <DataProvider>
          <Shell />
        </DataProvider>
      </AuthProvider>
    </HashRouter>
  )
}
