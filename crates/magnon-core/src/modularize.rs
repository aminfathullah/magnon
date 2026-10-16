use crate::options::TransformOptions;
use oxc_allocator::{Allocator, Box as OxcBox};
use oxc_ast::ast::*;
use oxc_ast::AstBuilder;

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

                if let Some((template, is_mui_mat)) = resolve_rule(source_str, options) {
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

                                    if is_mui_mat && !is_mui_component(member_name) {
                                        retained.push(ImportDeclarationSpecifier::ImportSpecifier(spec));
                                        continue;
                                    }

                                    let target_source = apply_template(template, member_name);
                                    let span = spec.span;
                                    let local_ident = spec.local.clone();

                                    let default_spec = ast.import_declaration_specifier_import_default_specifier(
                                        span,
                                        local_ident,
                                    );
                                    let mut new_specs = ast.vec_with_capacity(1);
                                    new_specs.push(default_spec);

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

                        for gen in generated {
                            new_body.push(gen);
                        }
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

fn resolve_rule<'a>(
    source: &str,
    options: &'a TransformOptions,
) -> Option<(&'a str, bool)> {
    if let Some(rule) = options.modularize_imports.get(source) {
        return Some((rule.transform.as_str(), false));
    }

    if options
        .optimize_package_imports
        .iter()
        .any(|pkg| pkg == source)
    {
        return match source {
            "@tabler/icons-react" => {
                Some(("@tabler/icons-react/dist/esm/icons/{{member}}.mjs", false))
            }
            "@mui/icons-material" => Some(("@mui/icons-material/{{member}}", false)),
            "@mui/material" => Some(("@mui/material/{{member}}", true)),
            "@mui/lab" => Some(("@mui/lab/{{member}}", false)),
            "lodash" => Some(("lodash/{{member}}", false)),
            "lodash-es" => Some(("lodash-es/{{member}}", false)),
            "date-fns" => Some(("date-fns/{{member}}", false)),
            "ramda" => Some(("ramda/es/{{member}}", false)),
            "react-bootstrap" => Some(("react-bootstrap/{{member}}", false)),
            "antd" => Some(("antd/es/{{member}}", false)),
            _ => None,
        };
    }

    None
}

pub fn is_mui_component(name: &str) -> bool {
    matches!(
        name,
        "Accordion"
            | "AccordionActions"
            | "AccordionDetails"
            | "AccordionSummary"
            | "Alert"
            | "AlertTitle"
            | "AppBar"
            | "Autocomplete"
            | "Avatar"
            | "AvatarGroup"
            | "Backdrop"
            | "Badge"
            | "BottomNavigation"
            | "BottomNavigationAction"
            | "Box"
            | "Breadcrumbs"
            | "Button"
            | "ButtonBase"
            | "ButtonGroup"
            | "Card"
            | "CardActionArea"
            | "CardActions"
            | "CardContent"
            | "CardHeader"
            | "CardMedia"
            | "Checkbox"
            | "Chip"
            | "CircularProgress"
            | "ClickAwayListener"
            | "Collapse"
            | "Container"
            | "CssBaseline"
            | "DefaultPropsProvider"
            | "Dialog"
            | "DialogActions"
            | "DialogContent"
            | "DialogContentText"
            | "DialogTitle"
            | "Divider"
            | "Drawer"
            | "Fab"
            | "Fade"
            | "FilledInput"
            | "FormControl"
            | "FormControlLabel"
            | "FormGroup"
            | "FormHelperText"
            | "FormLabel"
            | "GlobalStyles"
            | "Grid"
            | "Grow"
            | "Hidden"
            | "Icon"
            | "IconButton"
            | "ImageList"
            | "ImageListItem"
            | "ImageListItemBar"
            | "InitColorSchemeScript"
            | "Input"
            | "InputAdornment"
            | "InputBase"
            | "InputLabel"
            | "LinearProgress"
            | "Link"
            | "List"
            | "ListItem"
            | "ListItemAvatar"
            | "ListItemButton"
            | "ListItemIcon"
            | "ListItemSecondaryAction"
            | "ListItemText"
            | "ListSubheader"
            | "Menu"
            | "MenuItem"
            | "MenuList"
            | "MobileStepper"
            | "Modal"
            | "NativeSelect"
            | "NoSsr"
            | "OutlinedInput"
            | "Pagination"
            | "PaginationItem"
            | "Paper"
            | "Popover"
            | "Popper"
            | "Portal"
            | "Radio"
            | "RadioGroup"
            | "Rating"
            | "ScopedCssBaseline"
            | "Select"
            | "Skeleton"
            | "Slide"
            | "Slider"
            | "Snackbar"
            | "SnackbarContent"
            | "SpeedDial"
            | "SpeedDialAction"
            | "SpeedDialIcon"
            | "Stack"
            | "Step"
            | "StepButton"
            | "StepConnector"
            | "StepContent"
            | "StepIcon"
            | "StepLabel"
            | "Stepper"
            | "StyledEngineProvider"
            | "SvgIcon"
            | "SwipeableDrawer"
            | "Switch"
            | "Tab"
            | "TabScrollButton"
            | "Table"
            | "TableBody"
            | "TableCell"
            | "TableContainer"
            | "TableFooter"
            | "TableHead"
            | "TablePagination"
            | "TableRow"
            | "TableSortLabel"
            | "Tabs"
            | "TextField"
            | "TextareaAutosize"
            | "ToggleButton"
            | "ToggleButtonGroup"
            | "Toolbar"
            | "Tooltip"
            | "Typography"
            | "Unstable_Grid2"
            | "Unstable_TrapFocus"
            | "Zoom"
            | "useAutocomplete"
            | "useMediaQuery"
            | "usePagination"
            | "useScrollTrigger"
    )
}
