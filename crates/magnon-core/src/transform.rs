use crate::allocator::ThreadLocalPool;
use crate::error::MagnonError;
use crate::modularize::optimize_program_imports;
use crate::options::{JsxRuntime, SourceType, TransformOptions, TransformResult};
use oxc_allocator::Allocator;
use oxc_codegen::Codegen;
use oxc_parser::Parser;
use oxc_semantic::SemanticBuilder;
use oxc_span::SourceType as OxcSourceType;
use oxc_transformer::{
    JsxOptions, JsxRuntime as OxcJsxRuntime, TransformOptions as OxcTransformOptions, Transformer,
    TypeScriptOptions,
};
use std::path::Path;

pub fn transform_source(
    source: &str,
    filename: &str,
    options: &TransformOptions,
) -> Result<TransformResult, MagnonError> {
    ThreadLocalPool::with_allocator(|allocator| {
        transform_with_allocator(allocator, source, filename, options)
    })
}

fn transform_with_allocator(
    allocator: &Allocator,
    source: &str,
    filename: &str,
    options: &TransformOptions,
) -> Result<TransformResult, MagnonError> {
    let source_type_kind = SourceType::from_path(filename);
    let mut oxc_source_type = match source_type_kind {
        SourceType::Tsx => OxcSourceType::default()
            .with_typescript(true)
            .with_jsx(true),
        SourceType::Ts => OxcSourceType::default()
            .with_typescript(true)
            .with_jsx(false),
        SourceType::Jsx => OxcSourceType::default()
            .with_typescript(false)
            .with_jsx(true),
        SourceType::Js => OxcSourceType::default()
            .with_typescript(false)
            .with_jsx(false),
    };
    oxc_source_type = oxc_source_type.with_module(true);

    let ret = Parser::new(allocator, source, oxc_source_type).parse();
    if !ret.errors.is_empty() {
        let first_err = ret.errors.first().unwrap();
        return Err(MagnonError::Parse {
            filename: filename.to_string(),
            message: first_err.to_string(),
        });
    }

    let mut program = ret.program;
    let path = Path::new(filename);

    optimize_program_imports(allocator, &mut program, options);

    let scoping = SemanticBuilder::new()
        .build(&program)
        .semantic
        .into_scoping();

    let mut oxc_options = OxcTransformOptions::default();
    if source_type_kind.is_typescript() {
        oxc_options.typescript = TypeScriptOptions::default();
    }
    if source_type_kind.is_jsx() {
        let runtime = match options.jsx_runtime {
            JsxRuntime::Automatic => OxcJsxRuntime::Automatic,
            JsxRuntime::Classic => OxcJsxRuntime::Classic,
        };
        oxc_options.jsx = JsxOptions {
            runtime,
            development: options.development,
            ..Default::default()
        };
    }

    let transformer = Transformer::new(allocator, path, &oxc_options);
    let transform_ret = transformer.build_with_scoping(scoping, &mut program);
    if !transform_ret.errors.is_empty() {
        let first_err = transform_ret.errors.first().unwrap();
        return Err(MagnonError::Transform {
            filename: filename.to_string(),
            message: first_err.to_string(),
        });
    }

    let codegen_res = Codegen::new().build(&program);

    Ok(TransformResult {
        code: codegen_res.code,
        map: codegen_res.map.map(|m| m.to_json_string()),
    })
}
