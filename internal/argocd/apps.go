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
	Sync           string `json:"sync"`
	Revision       string `json:"revision"`
	OperationPhase string `json:"operationPhase,omitempty"`
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
				Status string `json:"status"`
			} `json:"health"`
			Sync struct {
				Status   string `json:"status"`
				Revision string `json:"revision"`
			} `json:"sync"`
			OperationState *struct {
				Phase string `json:"phase"`
			} `json:"operationState"`
		} `json:"status"`
	} `json:"items"`
}

// Apps queries every instance in parallel and merges the results.
func (r *Registry) Apps(ctx context.Context) AppsResponse {
	var (
		mu   sync.Mutex
		res  = AppsResponse{Apps: []App{}, Errors: []InstanceError{}}
		wg   sync.WaitGroup
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
					Sync:          it.Status.Sync.Status,
					Revision:      it.Status.Sync.Revision,
				}
				if it.Status.OperationState != nil {
					app.OperationPhase = it.Status.OperationState.Phase
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
