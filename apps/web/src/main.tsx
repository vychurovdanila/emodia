import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { EmotionSpace } from './screens/EmotionSpace';
import './index.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root not found');

createRoot(container).render(
  <StrictMode>
    <EmotionSpace />
  </StrictMode>,
);
