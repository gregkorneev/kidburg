import { render } from 'preact';
import './styles/base.css';
import './styles/views.css';
import './styles/world.css';
import { App } from './components/App.jsx';
import { boot } from './state.js';

render(<App />, document.getElementById('app'));
boot();
