use magnon_core::{transform_source, JsxRuntime, TransformOptions};

#[test]
fn test_typescript_stripping() {
    let code = r#"
        interface User {
            id: number;
            name: string;
        }

        const getUser = (id: number): User => {
            return { id, name: "Alice" };
        };
    "#;

    let options = TransformOptions::default();
    let res = transform_source(code, "test.ts", &options).expect("Transform failed");
    assert!(!res.code.contains("interface User"));
    assert!(!res.code.contains(": number"));
    assert!(res.code.contains("getUser"));
}

#[test]
fn test_jsx_automatic_runtime() {
    let code = r#"
        export const App = () => {
            return <div className="card"><h1>Title</h1></div>;
        };
    "#;

    let options = TransformOptions {
        jsx_runtime: JsxRuntime::Automatic,
        ..Default::default()
    };
    let res = transform_source(code, "App.tsx", &options).expect("Transform failed");
    assert!(res.code.contains("react/jsx-runtime"));
    assert!(res.code.contains("_jsx"));
}

#[test]
fn test_complex_tsx_features() {
    let code = r#"
        import React, { useState } from 'react';

        type Status = 'active' | 'inactive';

        interface Props {
            initialStatus?: Status;
            count: number;
        }

        export const Counter: React.FC<Props> = ({ initialStatus = 'active', count }) => {
            const [status, setStatus] = useState<Status>(initialStatus);
            return (
                <div data-testid="counter" aria-label={`Status: ${status}`}>
                    <span>{count}</span>
                    <button onClick={() => setStatus('inactive')}>Deactivate</button>
                </div>
            );
        };
    "#;

    let options = TransformOptions::default();
    let res = transform_source(code, "Counter.tsx", &options).expect("Transform failed");
    assert!(res.code.contains("react/jsx-runtime"));
    assert!(!res.code.contains("interface Props"));
    assert!(!res.code.contains("type Status"));
    assert!(res.code.contains("Counter"));
}

#[test]
fn test_thread_local_arena_reuse() {
    let code = "const x: number = 1;";
    let options = TransformOptions::default();
    for _ in 0..100 {
        let res = transform_source(code, "iter.ts", &options).expect("Transform failed");
        assert!(res.code.contains("const x = 1"));
    }
}
