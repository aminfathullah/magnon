use magnon_core::{
    transform_source, JsxRuntime, PackageImportRule, TransformOptions,
};
use std::collections::HashMap;

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

#[test]
fn test_optimize_package_imports_tabler() {
    let code = r#"
        import { IconUsers, IconSearch as SearchIcon } from '@tabler/icons-react';
        export const icons = [IconUsers, SearchIcon];
    "#;

    let options = TransformOptions {
        optimize_package_imports: vec!["@tabler/icons-react".to_string()],
        ..Default::default()
    };
    let res = transform_source(code, "test.ts", &options).expect("Transform failed");
    assert!(res.code.contains("@tabler/icons-react/dist/esm/icons/IconUsers.mjs"));
    assert!(res.code.contains("@tabler/icons-react/dist/esm/icons/IconSearch.mjs"));
    assert!(!res.code.contains("from \"@tabler/icons-react\";"));
    assert!(!res.code.contains("from '@tabler/icons-react';"));
}

#[test]
fn test_optimize_package_imports_mui() {
    let code = r#"
        import { Button, Typography, alpha } from '@mui/material';
        export const node = { Button, Typography, alpha };
    "#;

    let options = TransformOptions {
        optimize_package_imports: vec!["@mui/material".to_string()],
        ..Default::default()
    };
    let res = transform_source(code, "test.ts", &options).expect("Transform failed");
    assert!(res.code.contains("@mui/material/Button"));
    assert!(res.code.contains("@mui/material/Typography"));
    assert!(res.code.contains("alpha"));
    assert!(res.code.contains("@mui/material"));
}

#[test]
fn test_modularize_imports_custom() {
    let code = r#"
        import { Header, Footer } from 'my-design-system';
        export const layout = { Header, Footer };
    "#;

    let mut rules = HashMap::new();
    rules.insert(
        "my-design-system".to_string(),
        PackageImportRule {
            transform: "my-design-system/es/{{member}}".to_string(),
            prevent_full_import: None,
            skip_default_conversion: None,
            pascal_case_only: None,
            include: None,
            exclude: None,
        },
    );

    let options = TransformOptions {
        modularize_imports: rules,
        ..Default::default()
    };
    let res = transform_source(code, "test.ts", &options).expect("Transform failed");
    assert!(res.code.contains("my-design-system/es/Header"));
    assert!(res.code.contains("my-design-system/es/Footer"));
}

#[test]
fn test_optimize_package_imports_lucide() {
    let code = r#"
        import { ArrowRight, UserCheck } from 'lucide-react';
        export const icons = [ArrowRight, UserCheck];
    "#;

    let options = TransformOptions {
        optimize_package_imports: vec!["lucide-react".to_string()],
        ..Default::default()
    };
    let res = transform_source(code, "test.ts", &options).expect("Transform failed");
    assert!(res.code.contains("lucide-react/dist/esm/icons/arrow-right"));
    assert!(res.code.contains("lucide-react/dist/esm/icons/user-check"));
}

#[test]
fn test_optimize_package_imports_mui_icons() {
    let code = r#"
        import { Visibility, Search } from '@mui/icons-material';
        export const icons = [Visibility, Search];
    "#;

    let options = TransformOptions {
        optimize_package_imports: vec!["@mui/icons-material".to_string()],
        ..Default::default()
    };
    let res = transform_source(code, "test.ts", &options).expect("Transform failed");
    assert!(res.code.contains("@mui/icons-material/esm/Visibility"));
    assert!(res.code.contains("@mui/icons-material/esm/Search"));
}

#[test]
fn test_template_case_transformations() {
    let code = r#"
        import { DataGridHeader, NavigationBar } from 'test-lib';
        export const el = [DataGridHeader, NavigationBar];
    "#;

    let mut rules = HashMap::new();
    rules.insert(
        "test-lib".to_string(),
        PackageImportRule {
            transform: "test-lib/dist/{{snakeCase member}}/{{upperCase member}}".to_string(),
            prevent_full_import: None,
            skip_default_conversion: None,
            pascal_case_only: None,
            include: None,
            exclude: None,
        },
    );

    let options = TransformOptions {
        modularize_imports: rules,
        ..Default::default()
    };
    let res = transform_source(code, "test.ts", &options).expect("Transform failed");
    assert!(res.code.contains("test-lib/dist/data_grid_header/DATAGRIDHEADER"));
    assert!(res.code.contains("test-lib/dist/navigation_bar/NAVIGATIONBAR"));
}

#[test]
fn test_modularize_imports_filters() {
    let code = r#"
        import { Button, Modal, useTheme, InternalHelper } from 'custom-ui';
        export const app = { Button, Modal, useTheme, InternalHelper };
    "#;

    let mut rules = HashMap::new();
    rules.insert(
        "custom-ui".to_string(),
        PackageImportRule {
            transform: "custom-ui/components/{{kebabCase member}}".to_string(),
            prevent_full_import: None,
            skip_default_conversion: None,
            pascal_case_only: Some(true),
            include: None,
            exclude: Some(vec!["InternalHelper".to_string()]),
        },
    );

    let options = TransformOptions {
        modularize_imports: rules,
        ..Default::default()
    };
    let res = transform_source(code, "app.tsx", &options).expect("Transform failed");
    assert!(res.code.contains("custom-ui/components/button"));
    assert!(res.code.contains("custom-ui/components/modal"));
    assert!(res.code.contains("useTheme"));
    assert!(res.code.contains("InternalHelper"));
    assert!(res.code.contains("custom-ui"));
}
