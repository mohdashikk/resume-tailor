import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import App from './App';
import { makeStore } from './app/store';
import './styles/global.css';

const { store, recovery } = makeStore(localStorage);
createRoot(document.getElementById('root')).render(<StrictMode><Provider store={store}><App recovered={recovery} /></Provider></StrictMode>);
