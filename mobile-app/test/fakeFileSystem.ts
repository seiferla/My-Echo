// In-memory replacement for expo-file-system, shared by the unit tests.
//
// Usage in a test file (the variable name must start with "mock", a Jest rule):
//
//   const mockFs = createFakeFileSystem();
//   jest.mock('expo-file-system', () => mockFs.module);
//
// The state lives in `mockFs`, outside the Jest module registry, so it survives
// jest.resetModules(): a fresh module instance sees the same files (like an app restart).
//
// This folder is named "test" on purpose: Jest does not run it as a test file,
// and SonarQube counts it as test code, not as uncovered app code.

type Parent = string | { uri: string };

const join = (parent: Parent, name: string) => `${typeof parent === 'string' ? parent : parent.uri}/${name}`;

export function createFakeFileSystem() {
    const files = new Map<string, string>();
    const dirs = new Set<string>();

    class Directory {
        uri: string;
        constructor(parent: Parent, name: string) {
            this.uri = join(parent, name);
        }
        get exists() {
            return dirs.has(this.uri);
        }
        create() {
            dirs.add(this.uri);
        }
        delete() {
            dirs.delete(this.uri);
            // Deleting while iterating is safe for a Map.
            for (const path of files.keys()) {
                if (path.startsWith(`${this.uri}/`)) files.delete(path);
            }
        }
    }

    class File {
        uri: string;
        constructor(parent: Parent, name: string) {
            this.uri = join(parent, name);
        }
        get exists() {
            return files.has(this.uri);
        }
        get size() {
            return files.get(this.uri)?.length ?? 0;
        }
        textSync() {
            const text = files.get(this.uri);
            if (text === undefined) throw new Error(`No such file: ${this.uri}`);
            return text;
        }
        write(text: string) {
            files.set(this.uri, text);
        }
        delete() {
            files.delete(this.uri);
        }
    }

    return {
        /** path → content */
        files,
        dirs,
        /** Pass this to jest.mock('expo-file-system', ...). */
        module: { File, Directory, Paths: { document: 'documents' } },
        clear() {
            files.clear();
            dirs.clear();
        },
    };
}
