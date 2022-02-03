import './fetch_annotation.css';
import { StatusMessage } from 'neuroglancer/status';
import { RefCounted } from 'neuroglancer/util/disposable';
import { removeFromParent } from 'neuroglancer/util/dom';
import { fetchOk } from 'neuroglancer/util/http_request';
import { makeIcon } from 'neuroglancer/widget/icon';
import { AppSettings } from 'neuroglancer/services/service';
import {makeLayer} from 'neuroglancer/layer';
// import {UserLayerWithAnnotations} from 'neuroglancer/ui/annotations';
import {SegmentationUserLayer} from 'neuroglancer/segmentation_user_layer';
// import {Uint64} from 'neuroglancer/util/uint64';

interface TracingJSON {
  brain_names: Array<string>
  brain_urls: Array<string>
}

export class FetchTracingAnnotationWidget extends RefCounted {
  public element: HTMLElement;
  private virusTimepoint: HTMLSelectElement;
  private primaryInjectionSite: HTMLSelectElement;

  // private addAnnotationButton: HTMLElement;
  private fetchButton: HTMLElement;
  // private numberNeuronsShownField: HTMLElement

  constructor(public layer: SegmentationUserLayer) {
    super();
    const virusTimepointOptions = ["HSV-H129_Disynaptic","HSV-H129_Trisynaptic","PRV_Disynaptic"];
    const primaryInjectionSiteOptions = ["Lob. I-V","Lob. VI, VII","Lob. VIII-X","Simplex","Crus I","Crus II","PM, CP"];

    const buttonText = 'Click to fetch';
    const buttonTitle = 'Fetch tracing brains';

    // Make the overall div for this tool
    this.element = document.createElement('div');
    this.element.classList.add('neuroglancer-fetch-tracing-tool');

    // Title for the tool
    const fetchTitle = document.createElement('h3');
    fetchTitle.innerText = "Load Viral Tracing annotations"
    fetchTitle.classList.add('neuroglancer-mouselight-tool-title')

    ///////// FILTER #1 /////////
    // Make the div for this fitler (i.e. set of fields)
    const filterField = document.createElement('div');
    
    // Virus timepoint -- e.g. "HSV-H129_Disynaptic" ,
    this.virusTimepoint = document.createElement('select');
    this.virusTimepoint.id = "mouselight-filter-type-1";
    this.virusTimepoint.classList.add('neuroglancer-fetch-mouselight-selection');

    virusTimepointOptions.forEach((option:string) => {
        const filter_option = document.createElement('option');
        filter_option.value = option;
        filter_option.text = option;
        this.virusTimepoint.add(filter_option);
      });

    // Primary injection site
    this.primaryInjectionSite = document.createElement('select');
    this.primaryInjectionSite.classList.add('neuroglancer-fetch-mouselight-selection');

    primaryInjectionSiteOptions.forEach((option:string) => {
        const filter_option = document.createElement('option');
        filter_option.value = option;
        filter_option.text = option;
        this.primaryInjectionSite.add(filter_option);
      });
  
    // Add child elements to parent filter element
    filterField.appendChild(fetchTitle);
    filterField.appendChild(this.virusTimepoint);
    filterField.appendChild(this.primaryInjectionSite);

    // SUBMIT QUERY BUTTON
    this.fetchButton = makeIcon({
      text: buttonText,
      title: buttonTitle,
      onClick: () => {this.fetchTracingBrains()},
    });
    
    this.fetchButton.classList.add('neuroglancer-fetch-mouselight-button');

    // // Text area showing how many tracing brains were fetched are shown
    // this.numberNeuronsShownField = document.createElement('p');
    // this.numberNeuronsShownField.innerHTML = '';
    // this.numberNeuronsShownField.classList.add('neuroglancer-mouselight-filter-title');

    // Now add all child elements to parent filter 
    this.element.appendChild(filterField);
    this.element.appendChild(this.fetchButton);
    // this.element.appendChild(this.numberNeuronsShownField);
    this.registerDisposer(() => removeFromParent(this.element));
  }
 
 async fetchTracingBrains() {
      // Filter #1
      const virusTimepoint = this.virusTimepoint.value;
      const primaryInjectionSite = this.primaryInjectionSite.value;
      console.log("Virus timepoint: " + virusTimepoint);
      console.log("Primary injection site: " + primaryInjectionSite);
      // Set up base url and append to it conditionally below
      let tracingURL = encodeURI(`${AppSettings.API_ENDPOINT}/tracing_annotations/${virusTimepoint}/${primaryInjectionSite}`)
      
      StatusMessage.showTemporaryMessage('Fetching tracing brains... ');
      
      try {
        const tracingJSON:TracingJSON = await fetchOk(tracingURL, {
          method: 'GET',
        }).then(response => {
          return response.json();
        });

        const brain_names = tracingJSON.brain_names;
        const n_brains_fetched = tracingJSON.brain_urls.length;
        if (n_brains_fetched > 10) {
          StatusMessage.showTemporaryMessage('More than 10 brains would be fetched. Please adjust your search to fetch 10 or fewer');
          throw("Error");
        }

        let brain_counter = 0;        
        tracingJSON.brain_urls.forEach((precomputed_url:string) => {
          const brain_name = brain_names[brain_counter]
          // Get list of layer names 
          const layerSet = this.layer.manager.layerManager.layerSet;
          let layerNameArray = new Array<string>();
          layerSet.forEach((entry:any) => {
              layerNameArray.push(entry.name_)
            });
          console.log(layerNameArray);
          console.log(brain_name);

          // Only add new layer if layer not in layer list

          if (!layerNameArray.includes(brain_name)) {
            // pick a random color for the annotations
            let randomColor = Math.floor(Math.random()*16777215).toString(16);
            let hex_color =  '#' + randomColor;
            const newLayer = makeLayer(
              this.layer.manager, brain_name,
                {type: 'annotation',
                 'source': 'precomputed://' + precomputed_url,
                 'annotationColor': hex_color,
                 'shaderControls': {
                   "size":2.0,
                   "opacity":0.75}
               });

            this.layer.manager.add(newLayer);
          }
          else {
            StatusMessage.showTemporaryMessage(`Brain ${brain_name} is already loaded`);
            }
          brain_counter+=1;
        });
        
        StatusMessage.showTemporaryMessage(`Successfully fetched ${n_brains_fetched} tracing brains`);
        
        } catch (e) {
          StatusMessage.showTemporaryMessage('Unable to fetch tracing brains');
          throw e;
        }
    }
}