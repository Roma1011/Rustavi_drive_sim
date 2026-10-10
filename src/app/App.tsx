import { AppProviders } from './providers/AppProviders';
import { SimulatorShell } from '../features/simulator/components/SimulatorShell';

export function App() {
  return (
    <AppProviders>
      <SimulatorShell />
    </AppProviders>
  );
}
