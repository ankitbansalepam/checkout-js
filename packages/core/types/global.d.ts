declare const Sentry: any;

declare global {
    interface Scheduler {
        yield(): Promise<void>;
    }

    interface Window {
        sentryOnLoad?: () => void;
        scheduler?: Scheduler;
        Sentry?: typeof Sentry;
    }
}

export {};
