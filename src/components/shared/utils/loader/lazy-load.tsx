import React from 'react';
import Loadable from 'react-loadable';

export const makeLazyLoader =
    (importFn: () => Promise<any>, loaderFn: () => JSX.Element) => (component_name?: string) =>
        Loadable.Map({
            loader: {
                ComponentModule: importFn,
            },
            render(loaded: any, props: any) {
                // 1. Get the base module
                const module = loaded.ComponentModule;
                
                // 2. Extract the actual component
                // This handles both: export default Component AND export const Component
                let ComponentLazy;
                
                if (component_name) {
                    ComponentLazy = module[component_name] || (module.default && module.default[component_name]);
                } else {
                    ComponentLazy = module.default || module;
                }

                // 3. Safety check: If it's still a promise or object, try one level deeper
                if (ComponentLazy && ComponentLazy.default) {
                    ComponentLazy = ComponentLazy.default;
                }

                return <ComponentLazy {...props} />;
            },
            loading: loaderFn,
        });