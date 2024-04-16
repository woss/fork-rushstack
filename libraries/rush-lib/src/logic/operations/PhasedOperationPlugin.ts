// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import type { RushConfigurationProject } from '../../api/RushConfigurationProject';
import type { IPhase } from '../../api/CommandLineConfiguration';

import { Operation } from './Operation';
import { OperationStatus } from './OperationStatus';
import { NullOperationRunner } from './NullOperationRunner';
import type {
  ICreateOperationsContext,
  IPhasedCommandPlugin,
  PhasedCommandHooks
} from '../../pluginFramework/PhasedCommandHooks';
import { RushProjectConfiguration } from '../../api/RushProjectConfiguration';
import { ITerminal } from '@rushstack/terminal';
import { IOperationRunner } from './IOperationRunner';

const PLUGIN_NAME: 'PhasedOperationPlugin' = 'PhasedOperationPlugin';

/**
 * Core phased command plugin that provides the functionality for generating a base operation graph
 * from the set of selected projects and phases.
 */
export class PhasedOperationPlugin implements IPhasedCommandPlugin {
  public apply(hooks: PhasedCommandHooks): void {
    hooks.createOperations.tapPromise(PLUGIN_NAME, createOperations);
  }
}

async function createOperations(
  existingOperations: Set<Operation>,
  context: ICreateOperationsContext
): Promise<Set<Operation>> {
  const {
    projectsInUnknownState: changedProjects,
    phaseOriginal,
    phaseSelection,
    projectSelection,
    terminal
  } = context;
  const operationsWithWork: Set<Operation> = new Set();

  const allOperations: Map<string, Operation[]> = new Map();

  // Create tasks for selected phases and projects
  for (const phase of phaseOriginal) {
    for (const project of projectSelection) {
      await getOrCreateOperations(phase, project);
    }
  }

  // Recursively expand all consumers in the `operationsWithWork` set.
  for (const operation of operationsWithWork) {
    for (const consumer of operation.consumers) {
      operationsWithWork.add(consumer);
    }
  }

  for (const [key, operations] of allOperations) {
    for (const operation of operations) {
      if (!operationsWithWork.has(operation)) {
        // This operation is in scope, but did not change since it was last executed by the current command.
        // However, we have no state tracking across executions, so treat as unknown.
        operation.runner = new NullOperationRunner({
          name: key,
          result: OperationStatus.Skipped,
          silent: true
        });
      }
    }
  }

  return existingOperations;

  // Binds phaseSelection, projectSelection, operations via closure
  async function getOrCreateOperations(
    phase: IPhase,
    project: RushConfigurationProject
  ): Promise<Operation[]> {
    const key: string = getOperationKey(phase, project);
    let operations: Operation[] | undefined = allOperations.get(key);

    if (!operations) {
      operations = [];
      const shards = await getShards(phase, project, terminal!);
      if (shards && shards > 1) {
        const dependencies = [];
        const dependents = [];

        const buildCacheRestoreOperation = new Operation({
          project,
          phase
        });

        const sharedConfig = {
          cacheable: true,
          reportTiming: false,
          warningsAreAllowed: false,
          silent: true
        };

        buildCacheRestoreOperation.runner = {
          ...sharedConfig,
          name: 'buildCacheRestore',
          getConfigHash: () => '',
          executeAsync: async () => OperationStatus.Success
        };

        const buildCacheSaveOperation = new Operation({
          project,
          phase
        });
        buildCacheSaveOperation.runner = {
          ...sharedConfig,
          name: 'buildCacheSave',
          getConfigHash: () => '',
          executeAsync: async () => OperationStatus.Success
        };

        dependencies.push(buildCacheRestoreOperation);
        dependents.push(buildCacheSaveOperation);
        operations.push(...dependencies, ...dependents);
        operationsWithWork.add(buildCacheRestoreOperation);
        operationsWithWork.add(buildCacheSaveOperation);
        existingOperations.add(buildCacheSaveOperation);
        existingOperations.add(buildCacheRestoreOperation);

        const {
          dependencies: { self, upstream }
        } = phase;

        for (const depPhase of self) {
          for (const dependency of dependencies) {
            (await getOrCreateOperations(depPhase, project)).forEach((operation) =>
              dependency.addDependency(operation)
            );
          }
        }

        if (upstream.size) {
          const { dependencyProjects } = project;
          if (dependencyProjects.size) {
            for (const depPhase of upstream) {
              for (const dependencyProject of dependencyProjects) {
                for (const dependent of dependents) {
                  (await getOrCreateOperations(depPhase, dependencyProject)).forEach((operation) =>
                    dependent.addDependency(operation)
                  );
                }
              }
            }
          }
        }

        for (const shard of Array.from({ length: shards }, (_, index) => index + 1)) {
          let shardOperation = new Operation({
            project,
            phase,
            shard: {
              current: shard,
              max: shards
            }
          });
          dependencies.forEach((dependency) => shardOperation.addDependency(dependency));
          dependents.forEach((dependent) => dependent.addDependency(shardOperation));
          operationsWithWork.add(shardOperation);
          existingOperations.add(shardOperation);
          operations.push(shardOperation);
        }
        allOperations.set(key, operations);
      } else {
        const operation = new Operation({
          project,
          phase
        });

        if (!phaseSelection.has(phase) || !projectSelection.has(project)) {
          // Not in scope. Mark skipped because state is unknown.
          operation.runner = new NullOperationRunner({
            name: key,
            result: OperationStatus.Skipped,
            silent: true
          });
        } else if (changedProjects.has(project)) {
          operationsWithWork.add(operation);
        }

        allOperations.set(key, [operation]);
        existingOperations.add(operation);

        const {
          dependencies: { self, upstream }
        } = phase;

        for (const depPhase of self) {
          (await getOrCreateOperations(depPhase, project)).forEach((op) => operation.addDependency(op));
        }

        if (upstream.size) {
          const { dependencyProjects } = project;
          if (dependencyProjects.size) {
            for (const depPhase of upstream) {
              for (const dependencyProject of dependencyProjects) {
                (await getOrCreateOperations(depPhase, dependencyProject)).forEach((op) =>
                  operation.addDependency(op)
                );
              }
            }
          }
        }
      }
    }

    return operations;
  }
}

async function getShards(
  phase: IPhase,
  project: RushConfigurationProject,
  terminal: ITerminal
): Promise<number | undefined> {
  const rushProjectConfiguration = await RushProjectConfiguration.tryLoadForProjectAsync(project, terminal);
  if (rushProjectConfiguration) {
    return rushProjectConfiguration.operationSettingsByOperationName.get(phase.name)?.shards;
  }
}

// Convert the [IPhase, RushConfigurationProject] into a value suitable for use as a Map key
function getOperationKey(phase: IPhase, project: RushConfigurationProject): string {
  return `${project.packageName};${phase.name}`;
}
