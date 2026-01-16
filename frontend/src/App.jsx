import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/layout/Layout';
import ListView from './components/list/ListView';
import RecordingView from './components/recording/RecordingView';
import DetailView from './components/detail/DetailView';
import HotwordsView from './components/hotwords/HotwordsView';
import './styles/index.css';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<ListView />} />
          <Route path="recording" element={<RecordingView />} />
          <Route path="recording/:id" element={<RecordingView />} />
          <Route path="detail/:id" element={<DetailView />} />
          <Route path="hotwords" element={<HotwordsView />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
