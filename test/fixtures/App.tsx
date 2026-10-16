import React from 'react';

export interface AppProps {
  initialCount?: number;
}

export const App: React.FC<AppProps> = ({ initialCount = 0 }) => {
  const [count, setCount] = React.useState<number>(initialCount);
  return (
    <div className="container">
      <h1>Magnon Test App</h1>
      <button onClick={() => setCount(c => c + 1)}>Count: {count}</button>
    </div>
  );
};
