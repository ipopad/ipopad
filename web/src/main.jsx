import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { CrashBoundary } from './components/Crash.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(<CrashBoundary><App /></CrashBoundary>);
