use crate::options::TransformOptions;
use oxc_allocator::{Allocator, Box as OxcBox};
use oxc_ast::ast::*;
use oxc_ast::AstBuilder;

pub enum MemberFilter<'a> {
    Slice(&'a [&'static str]),
    Vec(&'a [String]),
}

impl<'a> MemberFilter<'a> {
    pub fn contains(&self, item: &str) -> bool {
        match self {
            MemberFilter::Slice(slice) => slice.iter().any(|s| *s == item),
            MemberFilter::Vec(vec) => vec.iter().any(|s| s.as_str() == item),
        }
    }
}

pub struct ResolvedRule<'a> {
    pub transform: &'a str,
    pub skip_default_conversion: bool,
    pub pascal_case_only: bool,
    pub include: Option<MemberFilter<'a>>,
    pub exclude: Option<MemberFilter<'a>>,
}

pub fn optimize_program_imports<'a>(
    allocator: &'a Allocator,
    program: &mut Program<'a>,
    options: &TransformOptions,
) {
    if options.optimize_package_imports.is_empty() && options.modularize_imports.is_empty() {
        return;
    }

    let ast = AstBuilder::new(allocator);
    let mut new_body = ast.vec_with_capacity(program.body.len());

    for stmt in program.body.drain(..) {
        match stmt {
            Statement::ImportDeclaration(mut import_decl) => {
                let source_str = import_decl.source.value.as_str();

                if let Some(rule) = resolve_rule(source_str, options) {
                    if let Some(specifiers) = import_decl.specifiers.take() {
                        let mut retained = ast.vec();
                        let mut generated = Vec::new();

                        for specifier in specifiers {
                            match specifier {
                                ImportDeclarationSpecifier::ImportSpecifier(spec) => {
                                    if matches!(spec.import_kind, ImportOrExportKind::Type) {
                                        retained.push(ImportDeclarationSpecifier::ImportSpecifier(spec));
                                        continue;
                                    }

                                    let member_name = spec.imported.name().as_str();

                                    if rule.pascal_case_only
                                        && (!member_name
                                            .chars()
                                            .next()
                                            .map_or(false, |c| c.is_ascii_uppercase())
                                            || member_name.ends_with("Props"))
                                    {
                                        retained.push(ImportDeclarationSpecifier::ImportSpecifier(spec));
                                        continue;
                                    }

                                    if let Some(ref ex) = rule.exclude {
                                        if ex.contains(member_name) {
                                            retained.push(ImportDeclarationSpecifier::ImportSpecifier(spec));
                                            continue;
                                        }
                                    }

                                    if let Some(ref inc) = rule.include {
                                        if !inc.contains(member_name) {
                                            retained.push(ImportDeclarationSpecifier::ImportSpecifier(spec));
                                            continue;
                                        }
                                    }

                                    let target_source = apply_template(rule.transform, member_name);
                                    let span = spec.span;
                                    let local_ident = spec.local.clone();

                                    let new_spec = if rule.skip_default_conversion {
                                        ast.import_declaration_specifier_import_specifier(
                                            span,
                                            ast.module_export_name_identifier_reference(
                                                span,
                                                allocator.alloc_str(member_name),
                                            ),
                                            local_ident,
                                            ImportOrExportKind::Value,
                                        )
                                    } else {
                                        ast.import_declaration_specifier_import_default_specifier(
                                            span,
                                            local_ident,
                                        )
                                    };
                                    let mut new_specs = ast.vec_with_capacity(1);
                                    new_specs.push(new_spec);

                                    let source_str_arena = allocator.alloc_str(&target_source);
                                    let source_literal = ast.string_literal(span, source_str_arena, None);
                                    let new_decl = ast.alloc_import_declaration(
                                        span,
                                        Some(new_specs),
                                        source_literal,
                                        None,
                                        Option::<OxcBox<'a, WithClause<'a>>>::None,
                                        ImportOrExportKind::Value,
                                    );
                                    generated.push(Statement::ImportDeclaration(new_decl));
                                }
                                other => {
                                    retained.push(other);
                                }
                            }
                        }

                        if !retained.is_empty() {
                            import_decl.specifiers = Some(retained);
                            new_body.push(Statement::ImportDeclaration(import_decl));
                        }

                        new_body.extend(generated);
                    } else {
                        new_body.push(Statement::ImportDeclaration(import_decl));
                    }
                } else {
                    new_body.push(Statement::ImportDeclaration(import_decl));
                }
            }
            other => new_body.push(other),
        }
    }

    program.body = new_body;
}

fn apply_template(template: &str, member: &str) -> String {
    let mut res = template.replace("{{member}}", member);
    if res.contains("{{kebabCase member}}") {
        let kebab = to_kebab_case(member);
        res = res.replace("{{kebabCase member}}", &kebab);
    }
    if res.contains("{{lowerCase member}}") {
        let lower = member.to_lowercase();
        res = res.replace("{{lowerCase member}}", &lower);
    }
    if res.contains("{{upperCase member}}") {
        let upper = member.to_uppercase();
        res = res.replace("{{upperCase member}}", &upper);
    }
    if res.contains("{{camelCase member}}") {
        let camel = to_camel_case(member);
        res = res.replace("{{camelCase member}}", &camel);
    }
    if res.contains("{{snakeCase member}}") {
        let snake = to_snake_case(member);
        res = res.replace("{{snakeCase member}}", &snake);
    }
    res
}

fn to_kebab_case(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 4);
    for (i, ch) in s.chars().enumerate() {
        if ch.is_uppercase() {
            if i > 0 {
                out.push('-');
            }
            out.extend(ch.to_lowercase());
        } else {
            out.push(ch);
        }
    }
    out
}

fn to_snake_case(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 4);
    for (i, ch) in s.chars().enumerate() {
        if ch.is_uppercase() {
            if i > 0 {
                out.push('_');
            }
            out.extend(ch.to_lowercase());
        } else {
            out.push(ch);
        }
    }
    out
}

fn to_camel_case(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut capitalize_next = false;
    for (i, ch) in s.chars().enumerate() {
        if ch == '-' || ch == '_' {
            capitalize_next = true;
        } else if capitalize_next {
            out.extend(ch.to_uppercase());
            capitalize_next = false;
        } else if i == 0 {
            out.extend(ch.to_lowercase());
        } else {
            out.push(ch);
        }
    }
    out
}

fn resolve_rule<'a>(
    source: &str,
    options: &'a TransformOptions,
) -> Option<ResolvedRule<'a>> {
    if let Some(rule) = options.modularize_imports.get(source) {
        return Some(ResolvedRule {
            transform: rule.transform.as_str(),
            skip_default_conversion: rule.skip_default_conversion.unwrap_or(false),
            pascal_case_only: rule.pascal_case_only.unwrap_or(false),
            include: rule.include.as_deref().map(MemberFilter::Vec),
            exclude: rule.exclude.as_deref().map(MemberFilter::Vec),
        });
    }

    if options
        .optimize_package_imports
        .iter()
        .any(|pkg| pkg == source)
    {
        return match source {
            "@tabler/icons-react" => Some(ResolvedRule {
                transform: "@tabler/icons-react/dist/esm/icons/{{member}}.mjs",
                skip_default_conversion: false,
                pascal_case_only: false,
                include: None,
                exclude: None,
            }),
            "@mui/icons-material" => Some(ResolvedRule {
                transform: "@mui/icons-material/esm/{{member}}",
                skip_default_conversion: false,
                pascal_case_only: false,
                include: None,
                exclude: None,
            }),
            "@mui/material" => Some(ResolvedRule {
                transform: "@mui/material/{{member}}",
                skip_default_conversion: false,
                pascal_case_only: true,
                include: None,
                exclude: Some(MemberFilter::Slice(&[
                    "StyledEngineProvider",
                    "ThemeProvider",
                    "CssVarsProvider",
                    "AlertColor",
                    "PaletteMode",
                    "SelectChangeEvent",
                    "SnackbarCloseReason",
                    "SxProps",
                    "Theme",
                ])),
            }),
            "@mui/lab" => Some(ResolvedRule {
                transform: "@mui/lab/{{member}}",
                skip_default_conversion: false,
                pascal_case_only: true,
                include: None,
                exclude: None,
            }),
            "lucide-react" => Some(ResolvedRule {
                transform: "lucide-react/dist/esm/icons/{{kebabCase member}}",
                skip_default_conversion: false,
                pascal_case_only: false,
                include: None,
                exclude: None,
            }),
            "@heroicons/react/24/outline" => Some(ResolvedRule {
                transform: "@heroicons/react/24/outline/{{member}}",
                skip_default_conversion: false,
                pascal_case_only: false,
                include: None,
                exclude: None,
            }),
            "@heroicons/react/24/solid" => Some(ResolvedRule {
                transform: "@heroicons/react/24/solid/{{member}}",
                skip_default_conversion: false,
                pascal_case_only: false,
                include: None,
                exclude: None,
            }),
            "@phosphor-icons/react" => Some(ResolvedRule {
                transform: "@phosphor-icons/react/dist/csr/{{member}}",
                skip_default_conversion: false,
                pascal_case_only: false,
                include: None,
                exclude: None,
            }),
            "lodash" => Some(ResolvedRule {
                transform: "lodash/{{member}}",
                skip_default_conversion: false,
                pascal_case_only: false,
                include: None,
                exclude: None,
            }),
            "lodash-es" => Some(ResolvedRule {
                transform: "lodash-es/{{member}}",
                skip_default_conversion: false,
                pascal_case_only: false,
                include: None,
                exclude: None,
            }),
            "date-fns" => Some(ResolvedRule {
                transform: "date-fns/{{member}}",
                skip_default_conversion: false,
                pascal_case_only: false,
                include: None,
                exclude: None,
            }),
            "ramda" => Some(ResolvedRule {
                transform: "ramda/es/{{member}}",
                skip_default_conversion: false,
                pascal_case_only: false,
                include: None,
                exclude: None,
            }),
            "react-bootstrap" => Some(ResolvedRule {
                transform: "react-bootstrap/{{member}}",
                skip_default_conversion: false,
                pascal_case_only: true,
                include: None,
                exclude: None,
            }),
            "antd" => Some(ResolvedRule {
                transform: "antd/es/{{member}}",
                skip_default_conversion: false,
                pascal_case_only: false,
                include: None,
                exclude: None,
            }),
            "rxjs" => Some(ResolvedRule {
                transform: "rxjs/{{member}}",
                skip_default_conversion: false,
                pascal_case_only: false,
                include: None,
                exclude: None,
            }),
            "rxjs/operators" => Some(ResolvedRule {
                transform: "rxjs/operators/{{member}}",
                skip_default_conversion: false,
                pascal_case_only: false,
                include: None,
                exclude: None,
            }),
            _ => None,
        };
    }

    None
}
