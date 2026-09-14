package argocd

import (
	"context"
	"sort"
	"sync"
)

// App is the subset of an ArgoCD Application the list view renders.
type App struct {
	Instance       string `json:"instance"`
	Name           string `json:"name"`
	Namespace      string `json:"namespace"` // the Application's own namespace
	Project        string `json:"project"`
	DestServer     string `json:"destServer"`
	DestNamespace  string `json:"destNamespace"`
	Health         string `json:"health"`
	HealthMessage  string `json:"healthMessage,omitempty"`
	Sync           string `json:"sync"`
	Revision       string `json:"revision"`
	OperationPhase string `json:"operationPhase,omitempty"`

	// OperationFinishedAt is status.operationState.finishedAt: when the
	// application's last sync operation finished, success or failure. This is
	// "how long has it been in its current state" for a row.
	//
	// Rejected: status.reconciledAt updates on every reconcile loop
	// regardless of whether anything actually changed, so it would always
	// read as "just now" and tell a person nothing. The newest
	// status.history[].deployedAt is only appended on a *successful* sync, so
	// an application whose latest operation is failing would silently show
	// the time of the prior success instead -- which reads as healthier than
	// it is. operationState.finishedAt is set after every attempt and stays
	// populated until the next one, so it is named for what it is rather than
	// implying a successful deploy. RFC3339; the frontend humanises it.
	OperationFinishedAt string `json:"operationFinishedAt,omitempty"`

	// TotalResources is len(status.resources). A pointer: nil means the
	// instance never reported a resources list at all (status.resources was
	// absent), 0 means it reported one and it was empty -- those are
	// different facts about the application.
	TotalResources *int `json:"totalResources,omitempty"`
	// UnhealthyResources counts resources whose health is reported and is not
	// "Healthy". A resource with no health object at all (most ConfigMaps,
	// Secrets, Services, ...) does not count: absence of health reporting is
	// not the same as being unhealthy, and most resources on most
	// applications report no health, so counting them would put a false
	// number on nearly every row. Only meaningful alongside TotalResources,
	// so a plain int is enough -- it is 0 whenever there are no resources to
	// begin with.
	UnhealthyResources int `json:"unhealthyResources,omitempty"`
}

// InstanceError reports one instance that could not be queried.
type InstanceError struct {
	Instance string `json:"instance"`
	Message  string `json:"message"`
}

// AppsResponse is always returned with HTTP 200: a single unreachable instance
// must not blank the whole list.
type AppsResponse struct {
	Apps   []App           `json:"apps"`
	Errors []InstanceError `json:"errors"`
}

// applicationList mirrors only the ArgoCD fields used above.
type applicationList struct {
	Items []struct {
		Metadata struct {
			Name      string `json:"name"`
			Namespace string `json:"namespace"`
		} `json:"metadata"`
		Spec struct {
			Project     string `json:"project"`
			Destination struct {
				Server    string `json:"server"`
				Namespace string `json:"namespace"`
			} `json:"destination"`
		} `json:"spec"`
		Status struct {
			Health struct {
				Status  string `json:"status"`
				Message string `json:"message"`
			} `json:"health"`
			Sync struct {
				Status   string `json:"status"`
				Revision string `json:"revision"`
			} `json:"sync"`
			OperationState *struct {
				Phase      string `json:"phase"`
				FinishedAt string `json:"finishedAt"`
			} `json:"operationState"`
			Resources []struct {
				Health *struct {
					Status string `json:"status"`
				} `json:"health"`
			} `json:"resources"`
		} `json:"status"`
	} `json:"items"`
}

// Apps queries every instance in parallel and merges the results.
func (r *Registry) Apps(ctx context.Context) AppsResponse {
	var (
		mu  sync.Mutex
		res = AppsResponse{Apps: []App{}, Errors: []InstanceError{}}
		wg  sync.WaitGroup
	)
	for _, c := range r.All() {
		wg.Add(1)
		go func(c *Client) {
			defer wg.Done()
			reqCtx, cancel := context.WithTimeout(ctx, instanceTimeout)
			defer cancel()

			var list applicationList
			err := c.Get(reqCtx, "applications", &list)

			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				res.Errors = append(res.Errors, InstanceError{
					Instance: c.Instance().Name,
					Message:  err.Error(),
				})
				return
			}
			for _, it := range list.Items {
				app := App{
					Instance:      c.Instance().Name,
					Name:          it.Metadata.Name,
					Namespace:     it.Metadata.Namespace,
					Project:       it.Spec.Project,
					DestServer:    it.Spec.Destination.Server,
					DestNamespace: it.Spec.Destination.Namespace,
					Health:        it.Status.Health.Status,
					HealthMessage: it.Status.Health.Message,
					Sync:          it.Status.Sync.Status,
					Revision:      it.Status.Sync.Revision,
				}
				if it.Status.OperationState != nil {
					app.OperationPhase = it.Status.OperationState.Phase
					app.OperationFinishedAt = it.Status.OperationState.FinishedAt
				}
				if it.Status.Resources != nil {
					total := len(it.Status.Resources)
					app.TotalResources = &total
					for _, r := range it.Status.Resources {
						if r.Health != nil && r.Health.Status != "Healthy" {
							app.UnhealthyResources++
						}
					}
				}
				res.Apps = append(res.Apps, app)
			}
		}(c)
	}
	wg.Wait()

	sort.Slice(res.Apps, func(i, j int) bool {
		if res.Apps[i].Instance != res.Apps[j].Instance {
			return res.Apps[i].Instance < res.Apps[j].Instance
		}
		return res.Apps[i].Name < res.Apps[j].Name
	})
	sort.Slice(res.Errors, func(i, j int) bool { return res.Errors[i].Instance < res.Errors[j].Instance })
	return res
}
