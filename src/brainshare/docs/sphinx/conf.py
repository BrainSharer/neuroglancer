# Configuration file for the Sphinx documentation builder.
#
# For the full list of built-in configuration values, see the documentation:
# https://www.sphinx-doc.org/en/master/usage/configuration.html

# -- Project information -----------------------------------------------------
# https://www.sphinx-doc.org/en/master/usage/configuration.html#project-information
from urllib.request import urlretrieve
urlretrieve (
    "https://raw.githubusercontent.com/BrainSharer/pipeline/master/docs/sphinx/source/modules/header.rst",
    "modules/header.rst"
)


project = 'Brainsharer Neuroglancer'
copyright = '2024, David Kleinfeld Lab @UCSD'
author = 'David Kleinfeld Lab @UCSD'
release = '1.0'

# -- General configuration ---------------------------------------------------
# https://www.sphinx-doc.org/en/master/usage/configuration.html#general-configuration

extensions = ['sphinx_js']
primary_domain = 'js'
js_language = 'typescript'
js_source_path = '../../../../src'
exclude_patterns = ['_build', 'Thumbs.db', '.DS_Store']

# The name of the Pygments (syntax highlighting) style to use.
pygments_style = 'emacs'


# -- Options for HTML output -------------------------------------------------
html_theme = 'sphinx_rtd_theme'
html_static_path = ['_static']
html_logo = "_static/250.png"
html_theme_options = {
    'logo_only': True,
    'display_version': False,
    # Toc options
    'collapse_navigation': True,
    'titles_only': True
}
