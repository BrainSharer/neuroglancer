
Adjusting colors and normalization in Neuroglancer
==================================================
This page will describe how to adjust colors and normalization in the Neuroglancer viewer.

****

To adjust the colors or normalization in a Neuroglancer view, you need to go to the right side panel and look for the Shader
under the Rendering tab. Look for a small box icon to the right of the word 'Shader' and click that. A popup window will
appear and the default for grayscale images will appear in the popup. The code should look similar to the code in the 
Greyscale section below. You can copy and paste
the code from the Greyscale, Red, Green or sRGB sections into the Shader window and adjust the values as needed.
Decrease the larger number in the range if the images are very low contrast. The upper limit is 65535 for 16bit images.

Greyscale 
~~~~~~~~~

.. code-block:: c
   :linenos:

    #uicontrol invlerp normalized  (range=[0,65535])
    #uicontrol float gamma slider(min=0.05, max=2.5, default=1.0, step=0.05)

    void main() {
        float pix =  normalized();
        pix = pow(pix,gamma);
        emitGrayscale(pix) ;
    }

The above code will set a grayscale normalized CDF (cumulative distribution function) and a gamma correction slider. 
Note the value of 65535, this is an upper limit for the normalization of 16bit images.
You can adjust this number down to say 5000 for very low contrast images. 


Red
~~~

Copy the code below into the Shader popup window for red. 
(Note a very small range (5000) is set for low contrast images).
A tool to toggle the color on and off is also included.

.. code-block:: c
   :linenos:

    #uicontrol invlerp normalized  (range=[0,5000])
    #uicontrol float gamma slider(min=0.05, max=2.5, default=1.0, step=0.05)
    #uicontrol bool colour checkbox(default=true)

    void main() {
        float pix =  normalized();
        pix = pow(pix,gamma);

        if (colour) {
            emitRGB(vec3(pix,0,0));
        } else {
            emitGrayscale(pix) ;
        }
    }

Green
~~~~~

Copy the code below into the Shader popup window for green. 
(Note a very small range (5000) is set for low contrast images).
A tool to toggle the color on and off is also included.

.. code-block:: c
   :linenos:

    #uicontrol invlerp normalized  (range=[0,5000])
    #uicontrol float gamma slider(min=0.05, max=2.5, default=1.0, step=0.05)
    #uicontrol bool colour checkbox(default=true)

    void main() {
        float pix =  normalized();
        pix = pow(pix,gamma);

        if (colour) {
            emitRGB(vec3(0,pix,0));
        } else {
            emitGrayscale(pix) ;
        }
    }


sRGB
~~~~

This is for 3 channel sRGB images. Copy the code below into the Shader popup window for sRGB.

.. code-block:: c
   :linenos:

    #uicontrol invlerp toNormalized
    #uicontrol float gamma slider(min=0.05, max=2.5, default=1.0, step=0.05)

    void main () {
        emitRGB(vec3(pow(toNormalized(getDataValue(0)),gamma), pow(toNormalized(getDataValue(1)),gamma), pow(toNormalized(getDataValue(2)),gamma)));
    }

sRGB (option 2)
~~~~~~~~~~~~~~~

This is for 3 channel sRGB images. This has 3 normalization sliders. It works well but takes up a lot
of room in the rendering panel. Copy the code below into the Shader popup window for sRGB.

.. code-block:: c
   :linenos:

    #uicontrol invlerp red(channel=0)
    #uicontrol invlerp green(channel=1)
    #uicontrol invlerp blue(channel=2)

    void main() {
        emitRGB(vec3(red(), green(), blue()));
    }
