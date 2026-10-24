/// <reference types="vite/client" />
// Module map for convex-test, rooted at convex/ (the file name's extra dot keeps Convex from deploying it).
export const modules = import.meta.glob("./**/!(*.*.*)*.*s");
