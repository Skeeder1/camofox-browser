export interface HealthState {
	consecutiveNavFailures: number;
	lastSuccessfulNav: number;
	isRecovering: boolean;
	activeOps: number;
}

const healthState: HealthState = {
	consecutiveNavFailures: 0,
	lastSuccessfulNav: Date.now(),
	isRecovering: false,
	activeOps: 0,
};

export function getHealthState(): Readonly<HealthState> {
	return healthState;
}

export function incrementActiveOps(): void {
	healthState.activeOps++;
}

export function decrementActiveOps(): void {
	healthState.activeOps = Math.max(0, healthState.activeOps - 1);
}

export function setRecovering(value: boolean): void {
	healthState.isRecovering = value;
}

export function resetHealth(): void {
	healthState.consecutiveNavFailures = 0;
	healthState.lastSuccessfulNav = Date.now();
	healthState.isRecovering = false;
	healthState.activeOps = 0;
}
