const fs = require('fs');
const path = require('path');

const targetDir = path.join(__dirname, '../benchmarks/fixtures/react');
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

const componentTemplates = [
  (i) => `import React, { useState, useEffect, useCallback, useMemo } from 'react';

export interface DataRecord_${i} {
  id: string;
  index: number;
  label: string;
  score: number;
  isActive: boolean;
  metadata?: Record<string, unknown>;
}

export interface GridProps_${i} {
  title: string;
  initialItems: DataRecord_${i}[];
  onSelect?: (item: DataRecord_${i}) => void;
  maxRows?: number;
}

export const DataGrid_${i}: React.FC<GridProps_${i}> = ({
  title,
  initialItems,
  onSelect,
  maxRows = 50,
}) => {
  const [items, setItems] = useState<DataRecord_${i}[]>(initialItems);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [sortAsc, setSortAsc] = useState<boolean>(true);

  const filteredItems = useMemo(() => {
    return items
      .filter((item) => item.label.toLowerCase().includes(searchTerm.toLowerCase()))
      .slice(0, maxRows)
      .sort((a, b) => (sortAsc ? a.score - b.score : b.score - a.score));
  }, [items, searchTerm, sortAsc, maxRows]);

  const handleToggle = useCallback((id: string) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, isActive: !item.isActive } : item))
    );
  }, []);

  return (
    <div className="grid-container" data-grid-id="grid-${i}">
      <header className="grid-header">
        <h2>{title}</h2>
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Filter records..."
        />
        <button onClick={() => setSortAsc((v) => !v)}>
          Sort: {sortAsc ? 'Ascending' : 'Descending'}
        </button>
      </header>
      <div className="table-responsive">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Index</th>
              <th>Label</th>
              <th>Score</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.map((record) => (
              <tr key={record.id} className={record.isActive ? 'active-row' : 'inactive-row'}>
                <td>{record.id}</td>
                <td>{record.index}</td>
                <td>{record.label}</td>
                <td>{record.score.toFixed(2)}</td>
                <td>{record.isActive ? 'Active' : 'Disabled'}</td>
                <td>
                  <button onClick={() => onSelect?.(record)}>Select</button>
                  <button onClick={() => handleToggle(record.id)}>Toggle</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
`,
  (i) => `import React, { useState, useReducer, useRef } from 'react';

export type FormStatus_${i} = 'idle' | 'submitting' | 'success' | 'error';

export interface FormValues_${i} {
  username: string;
  email: string;
  role: 'admin' | 'user' | 'editor';
  subscribeNewsletter: boolean;
  bio?: string;
}

export interface FormProps_${i} {
  initialValues?: Partial<FormValues_${i}>;
  onSubmit: (values: FormValues_${i}) => Promise<boolean>;
}

export const RegistrationForm_${i}: React.FC<FormProps_${i}> = ({
  initialValues,
  onSubmit,
}) => {
  const [values, setValues] = useState<FormValues_${i}>({
    username: initialValues?.username ?? '',
    email: initialValues?.email ?? '',
    role: initialValues?.role ?? 'user',
    subscribeNewsletter: initialValues?.subscribeNewsletter ?? false,
    bio: initialValues?.bio ?? '',
  });

  const [status, setStatus] = useState<FormStatus_${i}>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setStatus('submitting');
    setErrorMessage(null);

    try {
      const ok = await onSubmit(values);
      if (ok) {
        setStatus('success');
      } else {
        setStatus('error');
        setErrorMessage('Submission failed on server validation.');
      }
    } catch (err: unknown) {
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Unknown network failure');
    }
  };

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <h3>Form Registration ${i}</h3>
      {errorMessage && <div className="error-banner">{errorMessage}</div>}
      {status === 'success' && <div className="success-banner">Successfully submitted!</div>}

      <div className="field-group">
        <label htmlFor="user-${i}">Username</label>
        <input
          ref={inputRef}
          id="user-${i}"
          type="text"
          value={values.username}
          onChange={(e) => setValues({ ...values, username: e.target.value })}
          required
        />
      </div>

      <div className="field-group">
        <label htmlFor="email-${i}">Email</label>
        <input
          id="email-${i}"
          type="email"
          value={values.email}
          onChange={(e) => setValues({ ...values, email: e.target.value })}
          required
        />
      </div>

      <div className="field-group">
        <label htmlFor="role-${i}">Role</label>
        <select
          id="role-${i}"
          value={values.role}
          onChange={(e) => setValues({ ...values, role: e.target.value as FormValues_${i}['role'] })}
        >
          <option value="user">User</option>
          <option value="editor">Editor</option>
          <option value="admin">Admin</option>
        </select>
      </div>

      <div className="field-group checkbox">
        <label>
          <input
            type="checkbox"
            checked={values.subscribeNewsletter}
            onChange={(e) => setValues({ ...values, subscribeNewsletter: e.target.checked })}
          />
          Subscribe to product updates
        </label>
      </div>

      <button type="submit" disabled={status === 'submitting'}>
        {status === 'submitting' ? 'Processing...' : 'Submit Profile'}
      </button>
    </form>
  );
};
`,
  (i) => `export interface MetricPoint_${i} {
  timestamp: number;
  value: number;
  category: string;
}

export interface MetricSummary_${i} {
  count: number;
  average: number;
  minimum: number;
  maximum: number;
  stdDeviation: number;
}

export function computeSummary_${i}(points: MetricPoint_${i}[]): MetricSummary_${i} {
  if (points.length === 0) {
    return { count: 0, average: 0, minimum: 0, maximum: 0, stdDeviation: 0 };
  }

  let sum = 0;
  let min = Infinity;
  let max = -Infinity;

  for (const p of points) {
    sum += p.value;
    if (p.value < min) min = p.value;
    if (p.value > max) max = p.value;
  }

  const average = sum / points.length;
  let varianceSum = 0;
  for (const p of points) {
    varianceSum += Math.pow(p.value - average, 2);
  }

  const stdDeviation = Math.sqrt(varianceSum / points.length);

  return {
    count: points.length,
    average,
    minimum: min,
    maximum: max,
    stdDeviation,
  };
}

export class MetricAggregator_${i} {
  private buffer: MetricPoint_${i}[] = [];

  constructor(public readonly retentionLimit: number = 1000) {}

  public record(val: number, category = 'default'): void {
    if (this.buffer.length >= this.retentionLimit) {
      this.buffer.shift();
    }
    this.buffer.push({
      timestamp: Date.now(),
      value: val,
      category,
    });
  }

  public getSummary(): MetricSummary_${i} {
    return computeSummary_${i}(this.buffer);
  }

  public clear(): void {
    this.buffer = [];
  }
}
`,
  (i) => `import React from 'react';

export interface CardMetric_${i} {
  title: string;
  val: string | number;
  delta: number;
  trend: 'up' | 'down' | 'flat';
}

export interface StatCardProps_${i} {
  metrics: CardMetric_${i}[];
  headerTitle: string;
  onRefresh?: () => void;
}

export const StatCardWidget_${i}: React.FC<StatCardProps_${i}> = ({
  metrics,
  headerTitle,
  onRefresh,
}) => {
  return (
    <section className="stat-card-widget">
      <div className="widget-header">
        <h3>{headerTitle}</h3>
        {onRefresh && <button onClick={onRefresh}>Refresh Data</button>}
      </div>
      <div className="metrics-row">
        {metrics.map((m, idx) => (
          <div key={idx} className="metric-tile">
            <span className="metric-title">{m.title}</span>
            <span className="metric-value">{m.val}</span>
            <span className={\`metric-delta \${m.trend}\`}>
              {m.trend === 'up' ? '▲' : m.trend === 'down' ? '▼' : '―'} {Math.abs(m.delta)}%
            </span>
          </div>
        ))}
      </div>
    </section>
  );
};
`
];

for (let i = 0; i < 100; i++) {
  const tmpl = componentTemplates[i % componentTemplates.length];
  const isTs = (i % componentTemplates.length) === 2;
  const ext = isTs ? 'ts' : 'tsx';
  const filePath = path.join(targetDir, `Component_${i}.${ext}`);
  fs.writeFileSync(filePath, tmpl(i), 'utf8');
}

console.log('Successfully generated 100 TypeScript / TSX components in benchmarks/fixtures/react');
