use oxc_allocator::Allocator;
use std::cell::RefCell;

thread_local! {
    static LOCAL_ALLOCATOR: RefCell<Allocator> = RefCell::new(Allocator::default());
}

pub struct ThreadLocalPool;

impl ThreadLocalPool {
    pub fn with_allocator<F, R>(f: F) -> R
    where
        F: FnOnce(&Allocator) -> R,
    {
        LOCAL_ALLOCATOR.with(|cell| {
            let mut allocator = cell.borrow_mut();
            allocator.reset();
            f(&allocator)
        })
    }
}
